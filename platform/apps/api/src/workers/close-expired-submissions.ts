import { Prisma, PrismaClient, type ChallengeStatus } from '@prisma/client';
import type { EventPublisher } from '../events/event-publisher.js';

const TRANSACTION_TIMEOUT_MS = 20_000;

export interface CloseExpiredSubmissionsDeps {
  prisma: PrismaClient;
  events: EventPublisher;
  now?: () => Date;
}

export interface CloseExpiredSubmissionsResult {
  closedChallengeIds: string[];
}

interface LockedChallengeRow {
  id: string;
  status: ChallengeStatus;
}

/**
 * Schließt automatisch die Einsendungsphase abgelaufener Challenges
 * (`OPEN`/`FULL` mit `submission_deadline < now` → `SUBMISSIONS_CLOSED`). Pendant zum
 * Slot-Expiration-Worker: pro Challenge eine eigene Transaktion mit Row-Lock,
 * idempotent, Event nach Commit.
 */
export async function closeExpiredSubmissions(
  deps: CloseExpiredSubmissionsDeps,
): Promise<CloseExpiredSubmissionsResult> {
  const { prisma, events } = deps;
  const now = deps.now?.() ?? new Date();

  const candidates = await prisma.challenge.findMany({
    where: { status: { in: ['OPEN', 'FULL'] }, submissionDeadline: { lt: now } },
    select: { id: true },
  });

  const closedChallengeIds: string[] = [];

  for (const { id: challengeId } of candidates) {
    const closed = await prisma.$transaction(
      async (tx) => {
        const locked = await tx.$queryRaw<LockedChallengeRow[]>(Prisma.sql`
          SELECT id, status FROM challenges WHERE id = ${challengeId}::uuid FOR UPDATE
        `);
        const challenge = locked[0];
        if (challenge === undefined) {
          return false;
        }
        // Zwischen Kandidatensuche und Lock kann sich der Status geändert haben.
        if (challenge.status !== 'OPEN' && challenge.status !== 'FULL') {
          return false;
        }
        await tx.challenge.update({ where: { id: challengeId }, data: { status: 'SUBMISSIONS_CLOSED' } });
        return true;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: TRANSACTION_TIMEOUT_MS,
        maxWait: TRANSACTION_TIMEOUT_MS,
      },
    );

    if (closed) {
      closedChallengeIds.push(challengeId);
      await events.publish({
        type: 'challenge.submissions_closed',
        occurredAt: now,
        payload: { challengeId, reason: 'deadline' },
      });
    }
  }

  return { closedChallengeIds };
}
