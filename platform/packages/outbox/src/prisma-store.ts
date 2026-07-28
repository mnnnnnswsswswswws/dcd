/**
 * Prisma-/PostgreSQL-Implementierung der Outbox-Ports.
 *
 * Das Herzstück ist die Claim-Abfrage mit `FOR UPDATE SKIP LOCKED`: Mehrere
 * Publisher-Instanzen können gleichzeitig arbeiten, überspringen gesperrte Zeilen und
 * greifen dadurch niemals dasselbe Event doppelt — ohne globale Sperre und ohne
 * Serialisierung des gesamten Durchsatzes.
 *
 * Zusätzlich wirkt `available_at` als Sichtbarkeits-Timeout: Ein Eintrag, der im
 * Status `PUBLISHING` hängen bleibt (abgestürzter Publisher), wird nach Ablauf
 * automatisch wieder beanspruchbar. Ohne das würden Events dauerhaft verwaisen.
 */

import type { OutboxEventInput, OutboxEventRecord, OutboxStore, OutboxWriter } from './types.js';
import { OutboxStatus } from './types.js';

/** Nur der Teil von Prisma, den wir wirklich brauchen — hält die Kopplung klein. */
export interface PrismaLike {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
  outboxEvent: {
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
  };
}

/** Standard-Sichtbarkeits-Timeout: so lange darf ein Publish-Versuch dauern. */
export const DEFAULT_VISIBILITY_TIMEOUT_MS = 60_000;

interface RawRow {
  sequence: bigint | number;
  event_id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  status: string;
  attempts: number;
  available_at: Date;
  published_at: Date | null;
  last_error: string | null;
  created_at: Date;
}

function toRecord(row: RawRow): OutboxEventRecord {
  return {
    sequence: BigInt(row.sequence),
    eventId: row.event_id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    eventType: row.event_type,
    payload: row.payload,
    status: row.status as OutboxEventRecord['status'],
    attempts: row.attempts,
    availableAt: row.available_at,
    publishedAt: row.published_at ?? undefined,
    lastError: row.last_error ?? undefined,
    createdAt: row.created_at,
  };
}

/**
 * Schreibt Outbox-Events. **Muss** mit dem Transaktionsclient der Domänenänderung
 * aufgerufen werden (`prisma.$transaction(async (tx) => …)`), damit Event und
 * Zustandsänderung im selben Commit landen (Architekturregel 4).
 */
export function createOutboxWriter(tx: PrismaLike): OutboxWriter {
  return {
    async insert(event: OutboxEventInput): Promise<OutboxEventRecord> {
      const row = (await tx.outboxEvent.create({
        data: {
          ...(event.eventId ? { eventId: event.eventId } : {}),
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          eventType: event.eventType,
          payload: event.payload as Record<string, unknown>,
        },
      })) as unknown as {
        sequence: bigint;
        eventId: string;
        status: string;
        attempts: number;
        availableAt: Date;
        createdAt: Date;
      };
      return {
        sequence: BigInt(row.sequence),
        eventId: row.eventId,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        payload: event.payload,
        status: row.status as OutboxEventRecord['status'],
        attempts: row.attempts,
        availableAt: row.availableAt,
        createdAt: row.createdAt,
      };
    },
  };
}

export function createPrismaOutboxStore(
  prisma: PrismaLike,
  visibilityTimeoutMs: number = DEFAULT_VISIBILITY_TIMEOUT_MS,
): OutboxStore {
  return {
    async claimBatch(limit: number, now: Date): Promise<OutboxEventRecord[]> {
      const visibleUntil = new Date(now.getTime() + visibilityTimeoutMs);
      // PENDING = neu oder nach Backoff fällig.
      // PUBLISHING mit abgelaufenem available_at = verwaister Versuch, erneut greifen.
      const rows = await prisma.$queryRawUnsafe<RawRow[]>(
        `
        WITH claimed AS (
          SELECT "sequence"
          FROM "outbox_events"
          WHERE "status" IN ('PENDING', 'PUBLISHING')
            AND "available_at" <= $1
          ORDER BY "sequence"
          LIMIT $2
          FOR UPDATE SKIP LOCKED
        )
        UPDATE "outbox_events" o
        SET "status" = 'PUBLISHING',
            "attempts" = o."attempts" + 1,
            "available_at" = $3
        FROM claimed c
        WHERE o."sequence" = c."sequence"
        RETURNING o.*;
        `,
        now,
        limit,
        visibleUntil,
      );
      return rows.map(toRecord);
    },

    async markPublished(sequences: readonly bigint[], now: Date): Promise<void> {
      if (sequences.length === 0) return;
      const list = sequences.map((s) => s.toString()).join(',');
      await prisma.$executeRawUnsafe(
        `UPDATE "outbox_events"
         SET "status" = 'PUBLISHED', "published_at" = $1, "last_error" = NULL
         WHERE "sequence" IN (${list});`,
        now,
      );
    },

    async markFailed(
      sequence: bigint,
      error: string,
      retryAt: Date | null,
      _now: Date,
    ): Promise<void> {
      if (retryAt === null) {
        await prisma.$executeRawUnsafe(
          `UPDATE "outbox_events" SET "status" = 'FAILED', "last_error" = $1 WHERE "sequence" = ${sequence.toString()};`,
          error,
        );
        return;
      }
      await prisma.$executeRawUnsafe(
        `UPDATE "outbox_events"
         SET "status" = 'PENDING', "last_error" = $1, "available_at" = $2
         WHERE "sequence" = ${sequence.toString()};`,
        error,
        retryAt,
      );
    },
  };
}

export { OutboxStatus };
