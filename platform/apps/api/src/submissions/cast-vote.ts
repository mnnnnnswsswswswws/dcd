import { Prisma, PrismaClient, type ChallengeStatus } from '@prisma/client';
import { apiError } from '@vcp/contracts';
import type { EventPublisher } from '../events/event-publisher.js';

const TRANSACTION_TIMEOUT_MS = 20_000;

export interface CastVoteDeps {
  prisma: PrismaClient;
  events: EventPublisher;
  now?: () => Date;
}

export interface CastVoteInput {
  challengeId: string;
  submissionId: string;
  voterId: string;
}

export interface CastVoteResult {
  voteId: string;
}

interface LockedChallengeRow {
  id: string;
  creator_id: string;
  status: ChallengeStatus;
}

// Zustände, in denen abgestimmt werden darf (vor dem Winner-Lock).
const VOTABLE_STATUSES: ChallengeStatus[] = ['OPEN', 'FULL', 'SUBMISSIONS_CLOSED'];

/**
 * Zählt eine Community-Stimme für eine Einsendung. Eine Stimme pro Nutzer pro
 * Challenge; der Ersteller darf nicht abstimmen (MVP-Regel). Nur freigegebene
 * (`APPROVED`) Einsendungen sind wählbar.
 */
export async function castVote(deps: CastVoteDeps, input: CastVoteInput): Promise<CastVoteResult> {
  const now = deps.now?.() ?? new Date();
  const { challengeId, submissionId, voterId } = input;

  const voteId = await deps.prisma.$transaction(
    async (tx) => {
      const locked = await tx.$queryRaw<LockedChallengeRow[]>(Prisma.sql`
        SELECT id, creator_id, status FROM challenges WHERE id = ${challengeId}::uuid FOR UPDATE
      `);
      const challenge = locked[0];
      if (challenge === undefined) {
        throw apiError('CHALLENGE_NOT_FOUND');
      }
      if (!VOTABLE_STATUSES.includes(challenge.status)) {
        throw apiError('CHALLENGE_INVALID_STATE');
      }
      if (challenge.creator_id === voterId) {
        throw apiError('CREATOR_CANNOT_VOTE');
      }

      const submission = await tx.submission.findUnique({ where: { id: submissionId } });
      if (submission === null || submission.challengeId !== challengeId) {
        throw apiError('SUBMISSION_NOT_FOUND');
      }
      if (submission.status !== 'APPROVED') {
        throw apiError('SUBMISSION_NOT_ELIGIBLE');
      }

      const already = await tx.vote.findUnique({
        where: { challengeId_voterId: { challengeId, voterId } },
      });
      if (already !== null) {
        throw apiError('ALREADY_VOTED');
      }

      const vote = await tx.vote.create({ data: { challengeId, submissionId, voterId } });
      return vote.id;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      timeout: TRANSACTION_TIMEOUT_MS,
      maxWait: TRANSACTION_TIMEOUT_MS,
    },
  );

  await deps.events.publish({
    type: 'vote.cast',
    occurredAt: now,
    payload: { challengeId, submissionId, voterId },
  });

  return { voteId };
}
