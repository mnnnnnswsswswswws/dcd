import { Prisma, PrismaClient, type ChallengeStatus } from '@prisma/client';
import { apiError } from '@vcp/contracts';
import { canTransitionChallenge } from '@vcp/domain';
import type { EventPublisher } from '../events/event-publisher.js';

const TRANSACTION_TIMEOUT_MS = 20_000;

export interface CloseSubmissionsDeps {
  prisma: PrismaClient;
  events: EventPublisher;
  now?: () => Date;
}

export interface CloseSubmissionsInput {
  challengeId: string;
  isAdmin: boolean;
}

export interface CloseSubmissionsResult {
  challengeId: string;
  status: 'SUBMISSIONS_CLOSED';
}

interface LockedChallengeRow {
  id: string;
  status: ChallengeStatus;
}

/**
 * Schließt die Einsendungsphase (`OPEN`/`FULL` → `SUBMISSIONS_CLOSED`). Erfordert
 * Admin-Rechte (produktiv typischerweise durch einen Fristen-Worker ausgelöst).
 */
export async function closeSubmissions(
  deps: CloseSubmissionsDeps,
  input: CloseSubmissionsInput,
): Promise<CloseSubmissionsResult> {
  if (!input.isAdmin) {
    throw apiError('NOT_ADMIN');
  }
  const now = deps.now?.() ?? new Date();
  const { challengeId } = input;

  await deps.prisma.$transaction(
    async (tx) => {
      const locked = await tx.$queryRaw<LockedChallengeRow[]>(Prisma.sql`
        SELECT id, status FROM challenges WHERE id = ${challengeId}::uuid FOR UPDATE
      `);
      const challenge = locked[0];
      if (challenge === undefined) {
        throw apiError('CHALLENGE_NOT_FOUND');
      }
      if (!canTransitionChallenge(challenge.status, 'SUBMISSIONS_CLOSED')) {
        throw apiError('CHALLENGE_INVALID_STATE');
      }
      await tx.challenge.update({ where: { id: challengeId }, data: { status: 'SUBMISSIONS_CLOSED' } });
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      timeout: TRANSACTION_TIMEOUT_MS,
      maxWait: TRANSACTION_TIMEOUT_MS,
    },
  );

  await deps.events.publish({
    type: 'challenge.submissions_closed',
    occurredAt: now,
    payload: { challengeId },
  });

  return { challengeId, status: 'SUBMISSIONS_CLOSED' };
}
