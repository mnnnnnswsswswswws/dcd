/**
 * Challenge Detail Cache (Scale S1, Aufgaben 8 und 9).
 *
 * Fängt virale Leselast ab. Die Leitplanke steht im Typ selbst, nicht nur im
 * Kommentar: Was hier herauskommt, ist als `PublicChallengeView` deklariert und
 * trägt `occupiedSlots` ausdrücklich als Anzeigewert. Für die Platzvergabe wird
 * dieser Wert nie herangezogen — `joinChallenge` zählt unter `SELECT … FOR UPDATE`
 * gegen die Primärtabelle (Architekturregeln 2, 3 und 9).
 *
 * Der Cache ist rein öffentlich: keine nutzerspezifischen Felder, damit die Antwort
 * geteilt und im CDN abgelegt werden darf (Regel 10).
 */

import type { PrismaClient } from '@prisma/client';
import { Cache, Visibility, type CacheStore } from '@vcp/cache';

export const CHALLENGE_DETAIL_NAMESPACE = 'challenge-detail';

/** Kurze TTL: Eine Challenge ändert sich selten, aber Statuswechsel sollen zügig sichtbar werden. */
export const CHALLENGE_DETAIL_TTL_MS = 15_000;
/** Innerhalb dieses Fensters wird ein veralteter Wert noch ausgeliefert und im Hintergrund erneuert. */
export const CHALLENGE_DETAIL_SWR_MS = 60_000;
/** „Existiert nicht" nur kurz merken, sonst bleiben neue Challenges zu lange unsichtbar. */
export const CHALLENGE_DETAIL_NEGATIVE_TTL_MS = 3_000;

/**
 * Öffentliche Sicht auf eine Challenge.
 *
 * `occupiedSlots` ist **anzeigeorientiert** und darf hinterherhinken. Der Name des
 * Feldes sagt das nicht von allein — deshalb steht es hier und in der Projektion.
 */
export interface PublicChallengeView {
  readonly challengeId: string;
  readonly title: string | null;
  readonly status: string;
  readonly prizeAmountCents: number;
  readonly maxSlots: number;
  /** Nur Anzeige. Niemals Grundlage einer Platzentscheidung. */
  readonly occupiedSlotsForDisplay: number;
  readonly selectionMode: string;
  readonly submissionDeadline: string | null;
}

export interface ChallengeDetailCacheDeps {
  readonly prisma: PrismaClient;
  readonly store: CacheStore;
  /** Aus `cache_namespaces`; ein Bump invalidiert alle Detailschlüssel auf einen Schlag. */
  readonly namespaceVersion?: number;
}

export class ChallengeDetailCache {
  private readonly prisma: PrismaClient;
  private readonly cache: Cache;
  private readonly version: number;

  constructor(deps: ChallengeDetailCacheDeps) {
    this.prisma = deps.prisma;
    this.cache = new Cache({ store: deps.store });
    this.version = deps.namespaceVersion ?? 1;
  }

  /**
   * Liest die öffentliche Ansicht. Bevorzugt die Projektion; fehlt sie noch (etwa
   * kurz nach der Veröffentlichung, bevor der Consumer nachgezogen ist), wird
   * direkt aus der Primärtabelle gelesen. So ist ein Projektionsrückstand nie
   * sichtbar als „Challenge existiert nicht".
   */
  async get(challengeId: string): Promise<PublicChallengeView | null> {
    return this.cache.getOrLoad<PublicChallengeView>({
      key: {
        namespace: CHALLENGE_DETAIL_NAMESPACE,
        version: this.version,
        id: challengeId,
        visibility: Visibility.PUBLIC,
      },
      ttlMs: CHALLENGE_DETAIL_TTL_MS,
      staleWhileRevalidateMs: CHALLENGE_DETAIL_SWR_MS,
      negativeTtlMs: CHALLENGE_DETAIL_NEGATIVE_TTL_MS,
      load: () => this.loadFromDb(challengeId),
    });
  }

  private async loadFromDb(challengeId: string): Promise<PublicChallengeView | null> {
    const projected = await this.prisma.challengePublicProjection.findUnique({
      where: { challengeId },
    });
    if (projected !== null) {
      return {
        challengeId: projected.challengeId,
        title: projected.title,
        status: projected.status,
        prizeAmountCents: projected.prizeAmountCents,
        maxSlots: projected.maxSlots,
        occupiedSlotsForDisplay: projected.occupiedSlots,
        selectionMode: projected.selectionMode,
        submissionDeadline: projected.submissionDeadline?.toISOString() ?? null,
      };
    }

    // Fallback auf die Primärquelle, solange die Projektion noch nicht steht.
    const challenge = await this.prisma.challenge.findUnique({ where: { id: challengeId } });
    if (challenge === null) return null;

    const occupied = await this.prisma.slot.count({
      where: {
        challengeId,
        status: { in: ['RESERVED', 'CAPTURING', 'UPLOADING', 'SUBMITTED'] },
      },
    });

    return {
      challengeId: challenge.id,
      title: challenge.title,
      status: challenge.status,
      prizeAmountCents: challenge.prizeAmountCents,
      maxSlots: challenge.maxSlots,
      occupiedSlotsForDisplay: occupied,
      selectionMode: challenge.selectionMode,
      submissionDeadline: challenge.submissionDeadline?.toISOString() ?? null,
    };
  }

  /** Gezielte Invalidierung einer einzelnen Challenge. */
  async invalidate(challengeId: string): Promise<void> {
    await this.cache.invalidate({
      namespace: CHALLENGE_DETAIL_NAMESPACE,
      version: this.version,
      id: challengeId,
      visibility: Visibility.PUBLIC,
    });
  }
}
