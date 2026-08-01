/**
 * Direktverarbeitung veröffentlichter Outbox-Einträge in das Read Model
 * (Scale S1, Consumer-Seite der Event-Kette).
 *
 * Liegt bewusst hier und nicht im Worker: Der Worker bleibt ein dünner Wrapper —
 * dasselbe Muster wie bei `expireSlots` und `closeExpiredSubmissions` —, damit die
 * Logik ohne Worker-Bootstrap testbar ist.
 *
 * Verwendung in zwei Rollen:
 *   • laufender Consumer, solange kein Pub/Sub-Abonnement konfiguriert ist;
 *   • Wiederaufbau nach einem Schema- oder Logikwechsel.
 *
 * Beide nutzen dieselbe idempotente, out-of-order-feste Anwendung — der Direktmodus
 * ist also kein Sonderpfad mit eigener Semantik.
 */

import type { PrismaClient } from '@prisma/client';
import { ProjectionOutcome, applyChallengeProjection } from './challenge-projection.js';

export const PROJECTION_NAME = 'challenge-public-projection';
export const DEFAULT_CONSUME_BATCH = 200;

export interface ConsumeStats {
  readonly processed: number;
  readonly applied: number;
  readonly duplicates: number;
  readonly stale: number;
  readonly ignored: number;
}

/**
 * Verarbeitet veröffentlichte Outbox-Einträge ab dem Checkpoint.
 *
 * Der Checkpoint wird **nach** dem Batch geschrieben. Bricht der Prozess mittendrin
 * ab, werden dieselben Einträge erneut gelesen — unschädlich, weil die Anwendung
 * idempotent ist. Andersherum (Checkpoint zuerst) gingen Events verloren.
 */
export async function consumeFromOutbox(
  prisma: PrismaClient,
  batchSize: number = DEFAULT_CONSUME_BATCH,
): Promise<ConsumeStats> {
  let processed = 0;
  let applied = 0;
  let duplicates = 0;
  let stale = 0;
  let ignored = 0;

  const checkpoint = await prisma.projectionCheckpoint.findUnique({
    where: { projectionName: PROJECTION_NAME },
  });
  let cursor = checkpoint?.lastSequence ?? 0n;

  const events = await prisma.outboxEvent.findMany({
    where: { sequence: { gt: cursor }, status: 'PUBLISHED' },
    orderBy: { sequence: 'asc' },
    take: batchSize,
  });
  if (events.length === 0) {
    return { processed: 0, applied: 0, duplicates: 0, stale: 0, ignored: 0 };
  }

  for (const e of events) {
    const result = await applyChallengeProjection(prisma, {
      // Die Sequenz ist der stabile Deduplizierungsschlüssel dieses Modus.
      messageId: `outbox:${e.sequence}`,
      eventType: e.eventType,
      aggregateType: e.aggregateType,
      aggregateId: e.aggregateId,
      sequence: e.sequence,
      payload: e.payload as Record<string, unknown>,
    });
    processed += 1;
    if (result.outcome === ProjectionOutcome.APPLIED) applied += 1;
    else if (result.outcome === ProjectionOutcome.DUPLICATE) duplicates += 1;
    else if (result.outcome === ProjectionOutcome.STALE) stale += 1;
    else ignored += 1;
    cursor = e.sequence;
  }

  await prisma.projectionCheckpoint.upsert({
    where: { projectionName: PROJECTION_NAME },
    create: { projectionName: PROJECTION_NAME, lastSequence: cursor },
    update: { lastSequence: cursor },
  });

  return { processed, applied, duplicates, stale, ignored };
}
