/**
 * Challenge Public Projection (Scale S1, Aufgaben 8 und 9).
 *
 * Baut aus Outbox-Events das öffentliche Read Model auf. Drei Eigenschaften, die
 * bewusst so und nicht anders gebaut sind:
 *
 *   1. **Idempotent.** Dieselbe Nachricht darf mehrfach ankommen (at-least-once);
 *      die Wirkung bleibt dieselbe.
 *   2. **Out-of-order-fest.** Pub/Sub liefert nicht sortiert. Eine Nachricht mit
 *      kleinerer Sequenz als der zuletzt angewandten wird verworfen, statt neueren
 *      Zustand zu überschreiben. Die Sequenz steht in der Projektionszeile selbst,
 *      damit Prüfung und Anwendung in derselben Transaktion liegen.
 *   3. **Nicht autoritativ.** `occupiedSlots` dient ausschließlich der Anzeige.
 *      Die Platzvergabe zählt weiterhin unter Row-Lock gegen `slots`
 *      (Architekturregeln 2 und 3) — diese Projektion darf dabei keine Rolle spielen.
 */

import type { PrismaClient } from '@prisma/client';

export interface ProjectionMessage {
  readonly messageId: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly sequence: bigint;
  readonly payload: Record<string, unknown>;
}

export const ProjectionOutcome = {
  APPLIED: 'APPLIED',
  /** Bereits verarbeitet — Duplikat. */
  DUPLICATE: 'DUPLICATE',
  /** Ältere Nachricht als der bereits angewandte Stand. */
  STALE: 'STALE',
  /** Event ist für diese Projektion nicht relevant. */
  IGNORED: 'IGNORED',
} as const;
export type ProjectionOutcome = (typeof ProjectionOutcome)[keyof typeof ProjectionOutcome];

const HANDLER_NAME = 'challenge-public-projection';

/** Events, die das öffentliche Bild einer Challenge verändern. */
const RELEVANT = new Set([
  'challenge.published',
  'challenge.slot_reserved',
  'challenge.slots_expired',
  'challenge.winner_locked',
  'payout.succeeded',
]);

/** Ermittelt die Challenge-ID; sie steckt je nach Event an anderer Stelle. */
function challengeIdOf(msg: ProjectionMessage): string | undefined {
  const fromPayload = msg.payload.challengeId;
  if (typeof fromPayload === 'string') return fromPayload;
  if (msg.aggregateType === 'challenge') return msg.aggregateId;
  return undefined;
}

export interface ApplyResult {
  readonly outcome: ProjectionOutcome;
  readonly challengeId?: string;
}

/**
 * Wendet eine Nachricht auf die Projektion an.
 *
 * Duplikatschutz und Zustandsänderung liegen in **einer** Transaktion: Erst wird die
 * Inbox-Zeile angelegt (Unique auf `(message_id, handler_name)` entscheidet das
 * Rennen), dann die Projektion fortgeschrieben. Bricht etwas ab, verschwindet beides.
 */
export async function applyChallengeProjection(
  prisma: PrismaClient,
  msg: ProjectionMessage,
): Promise<ApplyResult> {
  if (!RELEVANT.has(msg.eventType)) {
    return { outcome: ProjectionOutcome.IGNORED };
  }
  const challengeId = challengeIdOf(msg);
  if (challengeId === undefined) {
    return { outcome: ProjectionOutcome.IGNORED };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      // 1. Duplikatschutz — die Datenbank entscheidet, nicht Anwendungscode.
      await tx.processedMessage.create({
        data: { messageId: msg.messageId, handlerName: HANDLER_NAME },
      });

      // 2. Aktuellen Stand der Challenge aus der Primärquelle lesen. Die Projektion
      //    spiegelt Wahrheit, sie erfindet sie nicht aus Event-Payloads.
      const challenge = await tx.challenge.findUnique({ where: { id: challengeId } });
      if (challenge === null) {
        return { outcome: ProjectionOutcome.IGNORED, challengeId };
      }

      const existing = await tx.challengePublicProjection.findUnique({
        where: { challengeId },
      });

      // 3. Out-of-order: verspätete ältere Nachricht verwerfen.
      if (existing !== null && msg.sequence <= existing.lastSequence) {
        return { outcome: ProjectionOutcome.STALE, challengeId };
      }

      // Anzeige-Slotzahl: aus der Primärtabelle abgeleitet, aber ausdrücklich nur
      // für die Darstellung. Ein Rückstand hier ist unkritisch.
      const occupiedSlots = await tx.slot.count({
        where: {
          challengeId,
          status: { in: ['RESERVED', 'CAPTURING', 'UPLOADING', 'SUBMITTED'] },
        },
      });

      const data = {
        title: challenge.title,
        status: challenge.status,
        prizeAmountCents: challenge.prizeAmountCents,
        maxSlots: challenge.maxSlots,
        occupiedSlots,
        selectionMode: challenge.selectionMode,
        submissionDeadline: challenge.submissionDeadline,
        lastSequence: msg.sequence,
      };

      await tx.challengePublicProjection.upsert({
        where: { challengeId },
        create: { challengeId, ...data },
        update: data,
      });

      return { outcome: ProjectionOutcome.APPLIED, challengeId };
    });
  } catch (err) {
    // Unique-Verletzung auf der Inbox = diese Nachricht lief bereits durch.
    if (isUniqueViolation(err)) {
      return { outcome: ProjectionOutcome.DUPLICATE, challengeId };
    }
    throw err;
  }
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return code === 'P2002' || code === '23505';
}

/**
 * Baut die Projektion aus der Outbox nach — für Erstbefüllung und Wiederaufbau nach
 * einem Schema- oder Logikwechsel. Merkt sich den Fortschritt in
 * `projection_checkpoints`, damit ein Abbruch fortsetzbar bleibt.
 */
export async function rebuildChallengeProjection(
  prisma: PrismaClient,
  batchSize = 500,
): Promise<{ processed: number; applied: number }> {
  const checkpoint = await prisma.projectionCheckpoint.findUnique({
    where: { projectionName: HANDLER_NAME },
  });
  let cursor = checkpoint?.lastSequence ?? 0n;
  let processed = 0;
  let applied = 0;

  for (;;) {
    const events = await prisma.outboxEvent.findMany({
      where: { sequence: { gt: cursor } },
      orderBy: { sequence: 'asc' },
      take: batchSize,
    });
    if (events.length === 0) break;

    for (const e of events) {
      const result = await applyChallengeProjection(prisma, {
        // Beim Nachbau ist die Sequenz der stabile Schlüssel — so bleibt auch ein
        // wiederholter Rebuild idempotent.
        messageId: `rebuild:${e.sequence}`,
        eventType: e.eventType,
        aggregateType: e.aggregateType,
        aggregateId: e.aggregateId,
        sequence: e.sequence,
        payload: e.payload as Record<string, unknown>,
      });
      processed += 1;
      if (result.outcome === ProjectionOutcome.APPLIED) applied += 1;
      cursor = e.sequence;
    }

    await prisma.projectionCheckpoint.upsert({
      where: { projectionName: HANDLER_NAME },
      create: { projectionName: HANDLER_NAME, lastSequence: cursor },
      update: { lastSequence: cursor },
    });
  }

  return { processed, applied };
}

export const CHALLENGE_PROJECTION_HANDLER = HANDLER_NAME;
