/**
 * Outbox-Anbindung der Domänen-Transaktionen (Scale S1, Architekturregel 4).
 *
 * Bisheriger Zustand: Events wurden **nach** dem Commit veröffentlicht. Das ist ein
 * klassischer Dual-Write — stürzt der Prozess zwischen Commit und Publish ab, ist das
 * Event verloren, obwohl der Zustand bereits geändert wurde.
 *
 * Ab hier schreibt jede relevante Transaktion ihr Event als Zeile in `outbox_events`,
 * und zwar **im selben Commit**. Damit gilt: Rollback der Domänenänderung heißt
 * automatisch auch Rollback des Events. Die Zustellung übernimmt danach der
 * Outbox-Publisher (at-least-once, idempotente Consumer).
 *
 * Der bestehende `EventPublisher` bleibt vorerst unverändert bestehen. Er ist heute
 * ein reiner Logging-Publisher und damit kein zweiter Zustellweg, sondern nur eine
 * Debug-Ausgabe — er kann entfallen, sobald der Pub/Sub-Publisher produktiv läuft.
 */

import type { Prisma } from '@prisma/client';

/** Transaktionsclient aus `prisma.$transaction(async (tx) => …)`. */
export type TxClient = Prisma.TransactionClient;

export interface OutboxEventInput {
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: Record<string, unknown>;
}

/**
 * Schreibt ein Outbox-Event **innerhalb** der laufenden Transaktion.
 *
 * Muss immer mit dem `tx`-Client aufgerufen werden, nie mit dem globalen
 * PrismaClient — sonst geht genau die Kopplung verloren, um die es hier geht.
 */
export async function writeOutboxEvent(
  tx: TxClient,
  event: OutboxEventInput,
): Promise<void> {
  await tx.outboxEvent.create({
    data: {
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      eventType: event.eventType,
      payload: event.payload as Prisma.InputJsonValue,
    },
  });
}

/** Mehrere Events in einem Rutsch — gleiche Garantie, ein Roundtrip. */
export async function writeOutboxEvents(
  tx: TxClient,
  events: readonly OutboxEventInput[],
): Promise<void> {
  if (events.length === 0) return;
  await tx.outboxEvent.createMany({
    data: events.map((e) => ({
      aggregateType: e.aggregateType,
      aggregateId: e.aggregateId,
      eventType: e.eventType,
      payload: e.payload as Prisma.InputJsonValue,
    })),
  });
}

/**
 * Aggregattypen. Bewusst als Konstanten, damit Projektionen und Consumer nicht auf
 * frei getippte Strings angewiesen sind.
 */
export const Aggregate = {
  CHALLENGE: 'challenge',
  SLOT: 'slot',
  SUBMISSION: 'submission',
  VOTE: 'vote',
  PAYMENT: 'payment',
  PAYOUT: 'payout',
  MODERATION: 'moderation',
} as const;
export type Aggregate = (typeof Aggregate)[keyof typeof Aggregate];
