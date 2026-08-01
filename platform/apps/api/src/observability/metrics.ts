/**
 * Metrik-Erhebung für die Dashboards (Scale S1, Aufgabe 15).
 *
 * Bewusst als ausführbarer Code statt als handgeschriebene Dashboard-Definition:
 * Eine JSON-Datei, die niemand ausführt, veraltet lautlos. Diese Funktionen fragen
 * die tatsächlichen Zahlen ab und sind testbar — die Dashboard-Definition rendert
 * anschließend nur noch, was hier erhoben wird.
 *
 * Sechs Bereiche entsprechend der Vorgabe: Cache, Queue, Outbox Lag, DB Connections,
 * Replica Lag und Business Integrity.
 */

import type { PrismaClient } from '@prisma/client';

export interface OutboxMetricsSnapshot {
  readonly pending: number;
  readonly publishing: number;
  readonly failed: number;
  /** Alter des ältesten unveröffentlichten Eintrags in Millisekunden. */
  readonly oldestPendingAgeMs: number;
  /** Einträge, die ihre Versuche aufgebraucht haben — brauchen menschliche Sichtung. */
  readonly exhausted: number;
}

export interface QueueMetricsSnapshot {
  readonly asyncOperationsPending: number;
  readonly asyncOperationsRunning: number;
  readonly asyncOperationsFailed: number;
  /** Laufende Operationen, die ungewöhnlich alt sind (Verdacht auf Hänger). */
  readonly stuckRunning: number;
}

export interface ProjectionMetricsSnapshot {
  readonly lastAppliedSequence: string;
  readonly latestOutboxSequence: string;
  /** Wie viele Events die Projektion hinterherhinkt. */
  readonly lagEvents: number;
}

export interface DbMetricsSnapshot {
  readonly activeConnections: number;
  readonly maxConnections: number;
  readonly utilizationPercent: number;
}

export interface ReplicaMetricsSnapshot {
  /** Replikationsverzögerung in Millisekunden; null, wenn keine Replik angebunden ist. */
  readonly lagMs: number | null;
  readonly replicaCount: number;
}

/**
 * Geschäftsintegrität — die Kennzahlen, die im Zweifel wichtiger sind als jede
 * Performance-Metrik. Jeder Wert ungleich 0 ist ein Stop-the-Line-Kandidat (§40).
 */
export interface BusinessIntegritySnapshot {
  /** Challenges mit mehr zählenden Slots als erlaubt — darf nie vorkommen. */
  readonly challengesOverCapacity: number;
  /** Challenges mit mehr als einer Gewinnerentscheidung. */
  readonly duplicateWinnerDecisions: number;
  /** Challenges mit mehr als einem Payout. */
  readonly duplicatePayouts: number;
  /** Ledger-Gruppen, deren Soll und Haben nicht übereinstimmen. */
  readonly unbalancedLedgerGroups: number;
  readonly healthy: boolean;
}

export interface MetricsSnapshot {
  readonly collectedAt: string;
  readonly outbox: OutboxMetricsSnapshot;
  readonly queue: QueueMetricsSnapshot;
  readonly projection: ProjectionMetricsSnapshot;
  readonly db: DbMetricsSnapshot;
  readonly replica: ReplicaMetricsSnapshot;
  readonly businessIntegrity: BusinessIntegritySnapshot;
}

/** Ab dieser Laufzeit gilt eine RUNNING-Operation als hängend. */
export const STUCK_OPERATION_MS = 15 * 60 * 1000;

export async function collectOutboxMetrics(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<OutboxMetricsSnapshot> {
  const [pending, publishing, failed, oldest] = await Promise.all([
    prisma.outboxEvent.count({ where: { status: 'PENDING' } }),
    prisma.outboxEvent.count({ where: { status: 'PUBLISHING' } }),
    prisma.outboxEvent.count({ where: { status: 'FAILED' } }),
    prisma.outboxEvent.findFirst({
      where: { status: { in: ['PENDING', 'PUBLISHING'] } },
      orderBy: { sequence: 'asc' },
      select: { createdAt: true },
    }),
  ]);

  return {
    pending,
    publishing,
    failed,
    exhausted: failed,
    oldestPendingAgeMs:
      oldest === null ? 0 : Math.max(0, now.getTime() - oldest.createdAt.getTime()),
  };
}

export async function collectQueueMetrics(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<QueueMetricsSnapshot> {
  const stuckBefore = new Date(now.getTime() - STUCK_OPERATION_MS);
  const [pending, running, failed, stuck] = await Promise.all([
    prisma.asyncOperation.count({ where: { status: 'PENDING' } }),
    prisma.asyncOperation.count({ where: { status: 'RUNNING' } }),
    prisma.asyncOperation.count({ where: { status: 'FAILED' } }),
    prisma.asyncOperation.count({
      where: { status: 'RUNNING', updatedAt: { lt: stuckBefore } },
    }),
  ]);
  return {
    asyncOperationsPending: pending,
    asyncOperationsRunning: running,
    asyncOperationsFailed: failed,
    stuckRunning: stuck,
  };
}

export async function collectProjectionMetrics(
  prisma: PrismaClient,
): Promise<ProjectionMetricsSnapshot> {
  const [checkpoint, latest] = await Promise.all([
    prisma.projectionCheckpoint.findFirst({ orderBy: { lastSequence: 'desc' } }),
    prisma.outboxEvent.findFirst({ orderBy: { sequence: 'desc' }, select: { sequence: true } }),
  ]);
  const applied = checkpoint?.lastSequence ?? 0n;
  const newest = latest?.sequence ?? 0n;
  return {
    lastAppliedSequence: applied.toString(),
    latestOutboxSequence: newest.toString(),
    lagEvents: Number(newest > applied ? newest - applied : 0n),
  };
}

export async function collectDbMetrics(prisma: PrismaClient): Promise<DbMetricsSnapshot> {
  const rows = await prisma.$queryRawUnsafe<Array<{ active: bigint; max: string }>>(
    `SELECT (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database())::bigint AS active,
            current_setting('max_connections') AS max`,
  );
  const active = Number(rows[0]?.active ?? 0n);
  const max = Number.parseInt(rows[0]?.max ?? '0', 10);
  return {
    activeConnections: active,
    maxConnections: max,
    utilizationPercent: max > 0 ? Math.round((active / max) * 100) : 0,
  };
}

export async function collectReplicaMetrics(
  prisma: PrismaClient,
): Promise<ReplicaMetricsSnapshot> {
  // pg_stat_replication ist auf der Primärinstanz gefüllt; ohne Replik leer.
  const rows = await prisma.$queryRawUnsafe<Array<{ lag_ms: number | null }>>(
    `SELECT COALESCE(EXTRACT(EPOCH FROM (write_lag))::float8 * 1000, 0) AS lag_ms
     FROM pg_stat_replication`,
  );
  if (rows.length === 0) return { lagMs: null, replicaCount: 0 };
  const worst = Math.max(...rows.map((r) => r.lag_ms ?? 0));
  return { lagMs: worst, replicaCount: rows.length };
}

/**
 * Prüft die Invarianten, die das Geschäftsmodell tragen, direkt in der Datenbank.
 *
 * Das sind keine Schätzungen: Jede dieser Abfragen findet einen Zustand, der laut
 * Produktregeln unmöglich ist. Ein Treffer bedeutet, dass eine Sperre versagt hat.
 */
export async function collectBusinessIntegrity(
  prisma: PrismaClient,
): Promise<BusinessIntegritySnapshot> {
  const [overCapacity, dupWinners, dupPayouts, unbalanced] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*)::bigint AS n FROM (
         SELECT s.challenge_id
         FROM slots s
         JOIN challenges c ON c.id = s.challenge_id
         WHERE s.status IN ('RESERVED','CAPTURING','UPLOADING','SUBMITTED')
         GROUP BY s.challenge_id, c.max_slots
         HAVING count(*) > c.max_slots
       ) x`,
    ),
    prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*)::bigint AS n FROM (
         SELECT challenge_id FROM winner_decisions GROUP BY challenge_id HAVING count(*) > 1
       ) x`,
    ),
    prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*)::bigint AS n FROM (
         SELECT challenge_id FROM payouts GROUP BY challenge_id HAVING count(*) > 1
       ) x`,
    ),
    prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*)::bigint AS n FROM (
         SELECT challenge_id, entry_type
         FROM ledger_entries
         GROUP BY challenge_id, entry_type
         HAVING sum(CASE WHEN direction = 'DEBIT' THEN amount_cents ELSE -amount_cents END) <> 0
       ) x`,
    ),
  ]);

  const challengesOverCapacity = Number(overCapacity[0]?.n ?? 0n);
  const duplicateWinnerDecisions = Number(dupWinners[0]?.n ?? 0n);
  const duplicatePayouts = Number(dupPayouts[0]?.n ?? 0n);
  const unbalancedLedgerGroups = Number(unbalanced[0]?.n ?? 0n);

  return {
    challengesOverCapacity,
    duplicateWinnerDecisions,
    duplicatePayouts,
    unbalancedLedgerGroups,
    healthy:
      challengesOverCapacity === 0 &&
      duplicateWinnerDecisions === 0 &&
      duplicatePayouts === 0 &&
      unbalancedLedgerGroups === 0,
  };
}

/** Erhebt alles auf einmal — die Datenquelle des Dashboards. */
export async function collectMetrics(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<MetricsSnapshot> {
  const [outbox, queue, projection, db, replica, businessIntegrity] = await Promise.all([
    collectOutboxMetrics(prisma, now),
    collectQueueMetrics(prisma, now),
    collectProjectionMetrics(prisma),
    collectDbMetrics(prisma),
    collectReplicaMetrics(prisma),
    collectBusinessIntegrity(prisma),
  ]);
  return {
    collectedAt: now.toISOString(),
    outbox,
    queue,
    projection,
    db,
    replica,
    businessIntegrity,
  };
}
