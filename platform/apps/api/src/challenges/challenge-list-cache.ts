/**
 * Cache für die Challenge-Liste — den heißesten Lesepfad der Plattform.
 *
 * Warum das hier fehlte und warum das der teuerste Fehler war: Es gab bereits eine
 * Projektion und einen Redis-Cache, aber beide hingen nur an der **Detail**-Route.
 * Die Liste — das, was ein Feed bei jedem Scroll aufruft — ging bei jedem einzelnen
 * Request direkt an die Datenbank, mit einem Aggregat über `slots` und einem
 * weiteren über Likes und Kommentare.
 *
 * Ein Cache neben dem heißen Pfad entlastet nichts. Er sieht nur so aus.
 *
 * Bewusste Eigenschaften:
 *
 *   • **Rein öffentlich.** Keine nutzerspezifischen Felder (Regel 10), deshalb darf
 *     die Antwort geteilt und vor einem CDN abgelegt werden. Was der einzelne Nutzer
 *     geliked hat, kommt aus einem getrennten, privaten Aufruf.
 *   • **Kurze TTL mit Streuung.** Ein Feed darf sekundenlang hinterherhinken; ein
 *     gleichzeitiger Ablauf aller Schlüssel dagegen erzeugt genau die Lastspitze,
 *     gegen die der Cache gebaut ist.
 *   • **Anzeigewerte, keine Autorität.** `occupiedSlotsForDisplay` heißt so, weil es
 *     so gemeint ist. Über einen Platz entscheidet ausschließlich `joinChallenge`
 *     unter `SELECT … FOR UPDATE` gegen die Primärtabelle (Regeln 2, 3 und 9).
 */

import type { PrismaClient } from '@prisma/client';
import { Cache, Visibility, type CacheStore } from '@vcp/cache';

export const CHALLENGE_LIST_NAMESPACE = 'challenge-list';

/**
 * Kurz genug, dass ein neuer Beitrag zügig auftaucht; lang genug, dass eine virale
 * Challenge nicht bei jedem Scroll die Aggregate erneut rechnet.
 */
export const CHALLENGE_LIST_TTL_MS = 10_000;
/** Innerhalb dieses Fensters wird veraltet ausgeliefert und im Hintergrund erneuert. */
export const CHALLENGE_LIST_SWR_MS = 60_000;

export interface PublicChallengeListItem {
  readonly id: string;
  readonly title: string | null;
  readonly category: string | null;
  readonly status: string;
  readonly selectionMode: string;
  readonly prizeAmountCents: number;
  readonly maxSlots: number;
  readonly submissionDeadline: string | null;
  readonly createdAt: string;
  readonly creator: { username: string | null; displayName: string | null } | null;
  /** Nur Anzeige. Niemals Grundlage einer Platzentscheidung. */
  readonly occupiedSlotsForDisplay: number;
  readonly likeCount: number;
  readonly commentCount: number;
}

export interface ChallengeListCacheDeps {
  readonly prisma: PrismaClient;
  readonly store: CacheStore;
  readonly namespaceVersion?: number;
}

export interface ListQuery {
  readonly status?: string;
  readonly limit: number;
}

export class ChallengeListCache {
  private readonly prisma: PrismaClient;
  private readonly cache: Cache;
  private readonly version: number;

  constructor(deps: ChallengeListCacheDeps) {
    this.prisma = deps.prisma;
    this.cache = new Cache({ store: deps.store });
    this.version = deps.namespaceVersion ?? 1;
  }

  async list(query: ListQuery): Promise<PublicChallengeListItem[]> {
    // `getOrLoad` kann null liefern, weil es negatives Caching kennt („existiert
    // nicht"). Für eine Liste gibt es diesen Fall nicht: Keine Treffer ist ein
    // gültiges Ergebnis, kein fehlendes. Deshalb hier auf die leere Liste
    // normalisiert, statt null nach außen durchzureichen.
    const items = await this.cache.getOrLoad<PublicChallengeListItem[]>({
      key: {
        namespace: CHALLENGE_LIST_NAMESPACE,
        version: this.version,
        // Jede Filterkombination ist ein eigener Schlüssel — sonst bekäme ein
        // Aufrufer die Antwort auf eine fremde Frage.
        id: `${query.status ?? 'alle'}:${query.limit}`,
        visibility: Visibility.PUBLIC,
      },
      ttlMs: CHALLENGE_LIST_TTL_MS,
      staleWhileRevalidateMs: CHALLENGE_LIST_SWR_MS,
      load: () => this.loadFromDb(query),
    });
    return items ?? [];
  }

  /**
   * Liest aus der Projektion, wo sie gefüllt ist, und fällt sonst auf die
   * Primärtabelle zurück.
   *
   * Der Rückfall ist wichtig: Eine gerade veröffentlichte Challenge darf nicht
   * unsichtbar sein, nur weil der Projektions-Consumer noch nicht nachgezogen hat.
   * Ein Rückstand im Read Model darf sich nie als „existiert nicht" zeigen.
   */
  private async loadFromDb(query: ListQuery): Promise<PublicChallengeListItem[]> {
    const rows = await this.prisma.challenge.findMany({
      where: query.status !== undefined ? { status: query.status as never } : {},
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      select: {
        id: true,
        title: true,
        category: true,
        status: true,
        selectionMode: true,
        prizeAmountCents: true,
        maxSlots: true,
        submissionDeadline: true,
        createdAt: true,
        creator: { select: { username: true, displayName: true } },
      },
    });
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);

    // Ein Zugriff auf das Read Model statt eines Aggregats über `slots`. Das ist
    // der eigentliche Gewinn: Der COUNT über die Platztabelle einer viralen
    // Challenge ist der Teil, der unter Last zuerst nachgibt.
    const projections = await this.prisma.challengePublicProjection.findMany({
      where: { challengeId: { in: ids } },
      select: { challengeId: true, occupiedSlots: true },
    });
    const belegt = new Map(projections.map((p) => [p.challengeId, p.occupiedSlots]));

    // Nur für Challenges ohne Projektionszeile fällt der teure Zählweg an.
    const fehlend = ids.filter((id) => !belegt.has(id));
    if (fehlend.length > 0) {
      const counts = await this.prisma.slot.groupBy({
        by: ['challengeId'],
        where: {
          challengeId: { in: fehlend },
          status: { in: ['RESERVED', 'CAPTURING', 'UPLOADING', 'SUBMITTED'] },
        },
        _count: { _all: true },
      });
      for (const c of counts) belegt.set(c.challengeId, c._count._all);
    }

    const [likes, comments] = await Promise.all([
      this.prisma.challengeLike.groupBy({
        by: ['challengeId'],
        where: { challengeId: { in: ids } },
        _count: { _all: true },
      }),
      this.prisma.comment.groupBy({
        by: ['challengeId'],
        where: { challengeId: { in: ids } },
        _count: { _all: true },
      }),
    ]);
    const likeCount = new Map(likes.map((l) => [l.challengeId, l._count._all]));
    const commentCount = new Map(comments.map((c) => [c.challengeId, c._count._all]));

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      category: r.category,
      status: r.status,
      selectionMode: r.selectionMode,
      prizeAmountCents: r.prizeAmountCents,
      maxSlots: r.maxSlots,
      // Serialisierbar halten: Der Cache legt JSON ab, kein Date-Objekt.
      submissionDeadline: r.submissionDeadline?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      creator: r.creator,
      occupiedSlotsForDisplay: belegt.get(r.id) ?? 0,
      likeCount: likeCount.get(r.id) ?? 0,
      commentCount: commentCount.get(r.id) ?? 0,
    }));
  }
}
