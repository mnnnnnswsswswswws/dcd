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

      // Anzeige-Slotzahl: aus der Primärtabelle abgeleitet, aber ausdrücklich nur
      // für die Darstellung. Ein Rückstand hier ist unkritisch.
      const occupiedSlots = await tx.slot.count({
        where: {
          challengeId,
          status: { in: ['RESERVED', 'CAPTURING', 'UPLOADING', 'SUBMITTED'] },
        },
      });

      // 3. Schreiben und Out-of-order-Schutz in **einer** Anweisung.
      //
      // Der naheliegende Weg — lastSequence lesen, vergleichen, dann schreiben —
      // ist ein Read-Modify-Write und unter parallelen Consumern ein Rennen: Zwei
      // Transaktionen lesen denselben Stand, beide halten ihre Nachricht für neuer,
      // und die zuletzt schreibende gewinnt. Beobachtet gegen echtes Pub/Sub mit
      // vier gleichzeitigen Zustellungen: `last_sequence` blieb hinter der höchsten
      // angewandten Sequenz zurück. Der Zustand war trotzdem korrekt (er wird aus
      // der Primärquelle gelesen, nicht aus dem Payload fortgeschrieben) — aber der
      // Schutz war schwächer als sein Name verspricht.
      //
      // `ON CONFLICT DO UPDATE … WHERE` entscheidet stattdessen die Datenbank, unter
      // der Zeilensperre, die der Konflikt ohnehin nimmt. Genau wie beim
      // Duplikatschutz zwei Schritte weiter oben.
      const betroffen = await tx.$executeRaw`
        INSERT INTO "challenge_public_projections" (
          "challenge_id", "title", "status", "prize_amount_cents", "max_slots",
          "occupied_slots", "selection_mode", "submission_deadline", "last_sequence", "updated_at"
        ) VALUES (
          ${challengeId}::uuid, ${challenge.title}, ${challenge.status},
          ${challenge.prizeAmountCents}, ${challenge.maxSlots}, ${occupiedSlots},
          ${challenge.selectionMode}, ${challenge.submissionDeadline}, ${msg.sequence}, now()
        )
        ON CONFLICT ("challenge_id") DO UPDATE SET
          "title" = EXCLUDED."title",
          "status" = EXCLUDED."status",
          "prize_amount_cents" = EXCLUDED."prize_amount_cents",
          "max_slots" = EXCLUDED."max_slots",
          "occupied_slots" = EXCLUDED."occupied_slots",
          "selection_mode" = EXCLUDED."selection_mode",
          "submission_deadline" = EXCLUDED."submission_deadline",
          "last_sequence" = EXCLUDED."last_sequence",
          "updated_at" = now()
        WHERE "challenge_public_projections"."last_sequence" < EXCLUDED."last_sequence"
      `;

      // Keine Zeile berührt heißt: Es lag bereits ein neuerer Stand vor.
      if (betroffen === 0) {
        return { outcome: ProjectionOutcome.STALE, challengeId };
      }

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
