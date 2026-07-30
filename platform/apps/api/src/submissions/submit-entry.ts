import { Prisma, PrismaClient, type ChallengeStatus } from '@prisma/client';
import { apiError } from '@vcp/contracts';
import { COUNTING_SLOT_STATUSES } from '@vcp/domain';
import type { EventPublisher } from '../events/event-publisher.js';
import { Aggregate, writeOutboxEvent } from '../events/outbox.js';
import { OPERATION_TTL_MS, OperationKind } from '../operations/async-operations.js';

const COUNTING = COUNTING_SLOT_STATUSES as unknown as string[];
const TRANSACTION_TIMEOUT_MS = 20_000;

export interface SubmitEntryDeps {
  prisma: PrismaClient;
  events: EventPublisher;
  now?: () => Date;
}

export interface SubmitEntryInput {
  challengeId: string;
  userId: string;
  /** Referenz auf die zuvor per Intent erzeugte In-App-Aufnahme. */
  evidenceRef?: string;
  /**
   * Erzwingt einen gültigen `evidenceRef` (Flag LONG_CAPTURE_ENABLED). Ist die
   * In-App-Aufnahme deaktiviert, bleibt es beim bisherigen Stub-Verhalten.
   */
  requireEvidence?: boolean;
}

export interface SubmitEntryResult {
  submissionId: string;
  status: 'SUBMITTED';
  /**
   * Gesetzt, wenn ein Beweisvideo gebunden wurde: Dessen Prüfung läuft asynchron
   * weiter. Der Aufrufer antwortet dann mit `202` und dieser Verfolgungs-ID
   * (Architekturregel 7).
   */
  operationId?: string;
}

interface LockedChallengeRow {
  id: string;
  creator_id: string;
  status: ChallengeStatus;
  submission_deadline: Date | null;
}

/**
 * Reicht die Einsendung des authentifizierten Teilnehmers ein.
 *
 * Stub: modelliert nur den Datensatz (das echte Beweisvideo kommt mit der
 * Capture/Upload-Pipeline). Voraussetzungen: Challenge nimmt Einsendungen an
 * (`OPEN`/`FULL`, Frist nicht überschritten), Nutzer hält einen zählenden Slot,
 * ist nicht der Ersteller, genau eine Einsendung pro Nutzer.
 */
export async function submitEntry(
  deps: SubmitEntryDeps,
  input: SubmitEntryInput,
): Promise<SubmitEntryResult> {
  const now = deps.now?.() ?? new Date();
  const { challengeId, userId, evidenceRef, requireEvidence } = input;

  if (requireEvidence === true && (evidenceRef === undefined || evidenceRef === '')) {
    throw apiError('EVIDENCE_REQUIRED');
  }

  const { submissionId, operationId } = await deps.prisma.$transaction(
    async (tx) => {
      const locked = await tx.$queryRaw<LockedChallengeRow[]>(Prisma.sql`
        SELECT id, creator_id, status, submission_deadline
        FROM challenges WHERE id = ${challengeId}::uuid FOR UPDATE
      `);
      const challenge = locked[0];
      if (challenge === undefined) {
        throw apiError('CHALLENGE_NOT_FOUND');
      }
      if (challenge.status !== 'OPEN' && challenge.status !== 'FULL') {
        throw apiError('CHALLENGE_INVALID_STATE');
      }
      if (challenge.submission_deadline !== null && now >= challenge.submission_deadline) {
        throw apiError('CHALLENGE_DEADLINE_PASSED');
      }
      if (challenge.creator_id === userId) {
        throw apiError('CREATOR_CANNOT_JOIN');
      }

      const slot = await tx.slot.findUnique({
        where: { challengeId_participantId: { challengeId, participantId: userId } },
      });
      if (slot === null || !COUNTING.includes(slot.status)) {
        throw apiError('NOT_A_PARTICIPANT');
      }

      const existing = await tx.submission.findUnique({
        where: { challengeId_participantId: { challengeId, participantId: userId } },
      });
      if (existing !== null) {
        throw apiError('ALREADY_SUBMITTED');
      }

      // In-App-Beweis binden, falls mitgegeben. Der Ref muss zu genau dieser
      // Teilnahme gehören und noch nicht an eine Einsendung gebunden sein.
      let boundEvidenceRef: string | null = null;
      if (evidenceRef !== undefined && evidenceRef !== '') {
        const asset = await tx.evidenceAsset.findUnique({ where: { id: evidenceRef } });
        if (
          asset === null ||
          asset.challengeId !== challengeId ||
          asset.participantId !== userId ||
          asset.status === 'ATTACHED'
        ) {
          throw apiError('EVIDENCE_INVALID');
        }
        await tx.evidenceAsset.update({ where: { id: asset.id }, data: { status: 'ATTACHED' } });
        boundEvidenceRef = asset.id;
      }

      const submission = await tx.submission.create({
        data: { challengeId, participantId: userId, status: 'SUBMITTED', evidenceRef: boundEvidenceRef },
      });
      // Slot spiegelt die Einreichung.
      await tx.slot.update({ where: { id: slot.id }, data: { status: 'SUBMITTED' } });

      // Prüfauftrag für das Beweisvideo — im **selben** Commit wie die Einsendung.
      //
      // Bis hierher galt ein Beweis als vorhanden, weil der Client es sagte: Er
      // bekam eine signierte Upload-URL und meldete danach die Einsendung, ohne
      // dass je jemand nachsah, ob Bytes ankamen. Eine Einsendung ohne Video wäre
      // erst bei der Gewinnerauswahl aufgefallen.
      //
      // Die Prüfung selbst ist ein Netzwerkaufruf und gehört nicht in diese
      // Transaktion — sie hält den Slot. Deshalb nur der Auftrag hier, gekoppelt
      // wie das Outbox-Ereignis: Gibt es die Einsendung, gibt es auch den Auftrag.
      let operationId: string | undefined;
      if (boundEvidenceRef !== null) {
        const op = await tx.asyncOperation.create({
          data: {
            kind: OperationKind.VIDEO_PROCESSING,
            status: 'PENDING',
            ownerUserId: userId,
            resourceType: 'submission',
            resourceId: submission.id,
            expiresAt: new Date(now.getTime() + OPERATION_TTL_MS),
          },
        });
        operationId = op.id;
      }

      // Outbox im selben Commit (Architekturregel 4).
      await writeOutboxEvent(tx, {
        aggregateType: Aggregate.SUBMISSION,
        aggregateId: submission.id,
        eventType: 'submission.finalized',
        payload: { challengeId, submissionId: submission.id, participantId: userId },
      });

      return { submissionId: submission.id, operationId };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      timeout: TRANSACTION_TIMEOUT_MS,
      maxWait: TRANSACTION_TIMEOUT_MS,
    },
  );

  await deps.events.publish({
    type: 'submission.created',
    occurredAt: now,
    payload: { challengeId, submissionId, participantId: userId },
  });

  return { submissionId, status: 'SUBMITTED', ...(operationId !== undefined ? { operationId } : {}) };
}
