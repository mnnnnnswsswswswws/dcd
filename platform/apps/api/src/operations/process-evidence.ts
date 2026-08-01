/**
 * Verarbeitet ausstehende Beweisprüfungen (Scale S1, Aufgabe 10).
 *
 * Die Gegenseite zu `202 Accepted`: Der Request legt eine Operation an und ist
 * fertig, diese Funktion erledigt die Arbeit und führt die Operation in einen
 * Endzustand. Erst dadurch wird aus der Verfolgungs-URL eine Zusage, die auch
 * eingelöst wird.
 *
 * Die Arbeit selbst ist keine Attrappe: Sie prüft, ob das Beweisvideo im Storage
 * **tatsächlich existiert**. Bis hierher galt ein Beweis als vorhanden, weil der
 * Client es sagte — er bekam eine signierte Upload-URL und meldete die Einsendung,
 * ohne dass je jemand nachsah, ob Bytes ankamen.
 *
 * Beanspruchung über `FOR UPDATE SKIP LOCKED` wie beim Outbox-Publisher: Mehrere
 * Worker dürfen parallel laufen, ohne sich gegenseitig zu blockieren oder dieselbe
 * Operation doppelt zu greifen.
 */

import type { PrismaClient } from '@prisma/client';
import { DEFAULT_TARGET_LOAD, deriveBatchSize } from '@vcp/capacity';
import type { EvidenceStorageProvider } from '../storage/storage-provider.js';
import { OperationKind, markFailed, markSucceeded } from './async-operations.js';

/** Sichtbarkeitsfenster: So lange gilt eine beanspruchte Operation als in Arbeit. */
export const CLAIM_VISIBILITY_MS = 5 * 60 * 1000;

/** Scheduler-Takt von worker-sweeps. Muss zu var.worker_schedules passen. */
const EVIDENCE_INTERVAL_SECONDS = 60;

/**
 * Einträge je Lauf — **abgeleitet**, nicht gewählt.
 *
 * Vorher stand hier 20, bei einem Takt von fünf Minuten: 4 Einsendungen pro Minute.
 * Ab der fünften wuchs der Rückstand unbegrenzt, und jeder Nutzer sah unbefristet
 * `PENDING`. Die Zahl war nirgends gegen eine Zielrate geprüft, weil nirgends eine
 * Zielrate stand.
 *
 * Jetzt kommt sie aus `@vcp/capacity`, und ein Test dort schlägt fehl, sobald sie
 * die Zielrate nicht mehr trägt.
 */
export const EVIDENCE_BATCH_SIZE = deriveBatchSize(
  DEFAULT_TARGET_LOAD.submissionsPerMinute * DEFAULT_TARGET_LOAD.headroomFactor,
  EVIDENCE_INTERVAL_SECONDS,
);

export const EvidenceError = {
  /** Kein Objekt unter dem Schlüssel — es wurde nie hochgeladen. */
  OBJECT_MISSING: 'EVIDENCE_OBJECT_MISSING',
  /** Objekt vorhanden, aber leer. Ein 0-Byte-Video ist kein Beweis. */
  OBJECT_EMPTY: 'EVIDENCE_OBJECT_EMPTY',
  /** Die Einsendung oder ihr Beweis ist zwischenzeitlich verschwunden. */
  RESOURCE_GONE: 'EVIDENCE_RESOURCE_GONE',
} as const;

export interface ProcessEvidenceStats {
  readonly claimed: number;
  readonly succeeded: number;
  readonly failed: number;
}

interface ClaimedRow {
  id: string;
  resource_id: string | null;
}

/**
 * Beansprucht bis zu `batchSize` ausstehende Prüfungen und arbeitet sie ab.
 *
 * Ein Fehler bei einer einzelnen Operation beendet den Durchlauf nicht — sonst
 * würde ein einzelnes kaputtes Objekt den gesamten Rückstand blockieren.
 */
export async function processEvidenceOperations(
  prisma: PrismaClient,
  storage: EvidenceStorageProvider,
  batchSize = EVIDENCE_BATCH_SIZE,
  now: Date = new Date(),
): Promise<ProcessEvidenceStats> {
  const sichtbarAb = new Date(now.getTime() - CLAIM_VISIBILITY_MS);

  // Beansprucht: PENDING, oder RUNNING mit abgelaufener Sichtbarkeit (der
  // vorherige Worker ist gestorben, bevor er fertig wurde).
  const claimed = await prisma.$queryRaw<ClaimedRow[]>`
    WITH claimed AS (
      SELECT "id" FROM "async_operations"
      WHERE "kind" = ${OperationKind.VIDEO_PROCESSING}
        AND ("status" = 'PENDING' OR ("status" = 'RUNNING' AND "updated_at" <= ${sichtbarAb}))
      ORDER BY "created_at"
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "async_operations" o
    SET "status" = 'RUNNING', "updated_at" = ${now}
    FROM claimed c WHERE o."id" = c."id"
    RETURNING o."id", o."resource_id"
  `;

  let succeeded = 0;
  let failed = 0;

  for (const row of claimed) {
    try {
      const ergebnis = await verifyOne(prisma, storage, row.resource_id);
      if (ergebnis.ok) {
        await markSucceeded(prisma, row.id, ergebnis.result, now);
        succeeded += 1;
      } else {
        await markFailed(prisma, row.id, ergebnis.code, ergebnis.message, now);
        failed += 1;
      }
    } catch (error) {
      // Eine Störung des Storage ist **kein** fehlender Beweis. Die Operation
      // bleibt RUNNING und wird nach Ablauf der Sichtbarkeit erneut beansprucht —
      // eine gültige Einsendung darf nicht wegen eines Netzwerkfehlers scheitern.
      console.error(
        `[evidence] Operation ${row.id} verschoben:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  return { claimed: claimed.length, succeeded, failed };
}

type VerifyResult =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; code: string; message: string };

async function verifyOne(
  prisma: PrismaClient,
  storage: EvidenceStorageProvider,
  submissionId: string | null,
): Promise<VerifyResult> {
  if (submissionId === null) {
    return { ok: false, code: EvidenceError.RESOURCE_GONE, message: 'Operation ohne Einsendung.' };
  }

  const submission = await prisma.submission.findUnique({ where: { id: submissionId } });
  if (submission === null || submission.evidenceRef === null) {
    return {
      ok: false,
      code: EvidenceError.RESOURCE_GONE,
      message: 'Einsendung oder Beweisreferenz existiert nicht mehr.',
    };
  }

  const asset = await prisma.evidenceAsset.findUnique({ where: { id: submission.evidenceRef } });
  if (asset === null) {
    return {
      ok: false,
      code: EvidenceError.RESOURCE_GONE,
      message: 'Beweisobjekt existiert nicht mehr.',
    };
  }

  const objekt = await storage.statObject(asset.storageKey);
  if (objekt === null) {
    return {
      ok: false,
      code: EvidenceError.OBJECT_MISSING,
      message: 'Unter dem Schlüssel liegt kein Objekt — der Upload wurde nie abgeschlossen.',
    };
  }
  if (objekt.sizeBytes <= 0) {
    return {
      ok: false,
      code: EvidenceError.OBJECT_EMPTY,
      message: 'Das hochgeladene Objekt ist leer.',
    };
  }

  return {
    ok: true,
    result: {
      submissionId,
      evidenceRef: asset.id,
      sizeBytes: objekt.sizeBytes,
      contentType: objekt.contentType,
    },
  };
}
