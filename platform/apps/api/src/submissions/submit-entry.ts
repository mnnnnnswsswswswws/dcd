import { Prisma, PrismaClient, type ChallengeStatus } from '@prisma/client';
import { apiError } from '@vcp/contracts';
import { COUNTING_SLOT_STATUSES } from '@vcp/domain';
import type { EventPublisher } from '../events/event-publisher.js';

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
}

export interface SubmitEntryResult {
  submissionId: string;
  status: 'SUBMITTED';
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
  const { challengeId, userId } = input;

  const submissionId = await deps.prisma.$transaction(
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

      const submission = await tx.submission.create({
        data: { challengeId, participantId: userId, status: 'SUBMITTED' },
      });
      // Slot spiegelt die Einreichung.
      await tx.slot.update({ where: { id: slot.id }, data: { status: 'SUBMITTED' } });

      return submission.id;
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

  return { submissionId, status: 'SUBMITTED' };
}
