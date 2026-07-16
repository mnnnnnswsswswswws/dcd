import { Prisma, PrismaClient, type ChallengeStatus, type SlotStatus } from '@prisma/client';
import { apiError } from '@vcp/contracts';
import { COUNTING_SLOT_STATUSES, canTransitionChallenge } from '@vcp/domain';
import type { EventPublisher } from '../events/event-publisher.js';
import { writeAudit } from '../audit/write-audit.js';

const COUNTING: SlotStatus[] = COUNTING_SLOT_STATUSES as unknown as SlotStatus[];
const TRANSACTION_TIMEOUT_MS = 20_000;
const ACCOUNT_ESCROW = 'CHALLENGE_ESCROW';
const ACCOUNT_REFUND = 'CREATOR_REFUND';

export interface CancelChallengeDeps {
  prisma: PrismaClient;
  events: EventPublisher;
  now?: () => Date;
}

export interface CancelChallengeInput {
  challengeId: string;
  actorId: string;
  isAdmin: boolean;
}

export interface CancelChallengeResult {
  challengeId: string;
  status: 'CANCELLED';
  refunded: boolean;
  alreadyCancelled: boolean;
}

interface LockedChallengeRow {
  id: string;
  creator_id: string;
  status: ChallengeStatus;
}

/**
 * Bricht eine Challenge ab und erstattet — falls bereits vollfinanziert — die
 * Preissumme idempotent an den Ersteller zurück.
 *
 * Zulässig vor Einsendeschluss (`DRAFT`/`PENDING_FUNDING`/`OPEN`/`FULL`). In einer
 * Transaktion unter Row-Lock: Status → `CANCELLED`, zählende Slots freigeben, und bei
 * bestätigter Finanzierung eine doppelte Ledger-Rückbuchung (Escrow → Creator-Refund)
 * mit `funding.status = REFUNDED`. Erneuter Aufruf ist ein No-Op.
 */
export async function cancelChallenge(
  deps: CancelChallengeDeps,
  input: CancelChallengeInput,
): Promise<CancelChallengeResult> {
  const now = deps.now?.() ?? new Date();
  const { challengeId, actorId, isAdmin } = input;

  const result = await deps.prisma.$transaction(
    async (tx) => {
      const locked = await tx.$queryRaw<LockedChallengeRow[]>(Prisma.sql`
        SELECT id, creator_id, status FROM challenges WHERE id = ${challengeId}::uuid FOR UPDATE
      `);
      const challenge = locked[0];
      if (challenge === undefined) {
        throw apiError('CHALLENGE_NOT_FOUND');
      }

      if (challenge.creator_id !== actorId && !isAdmin) {
        throw apiError('FORBIDDEN');
      }

      // Idempotenz.
      if (challenge.status === 'CANCELLED') {
        return { refunded: false, alreadyCancelled: true };
      }
      if (!canTransitionChallenge(challenge.status, 'CANCELLED')) {
        throw apiError('CHALLENGE_INVALID_STATE');
      }

      // Zählende Slots freigeben.
      await tx.slot.updateMany({
        where: { challengeId, status: { in: COUNTING } },
        data: { status: 'CANCELLED' },
      });

      // Erstattung nur, wenn bereits vollfinanziert.
      let refunded = false;
      const funding = await tx.challengeFunding.findUnique({ where: { challengeId } });
      if (funding !== null && funding.status === 'CONFIRMED') {
        await tx.challengeFunding.update({ where: { id: funding.id }, data: { status: 'REFUNDED' } });
        await tx.ledgerEntry.createMany({
          data: [
            {
              challengeId,
              account: ACCOUNT_ESCROW,
              direction: 'DEBIT',
              amountCents: funding.amountCents,
              entryType: 'REFUND',
              referenceId: funding.id,
            },
            {
              challengeId,
              account: ACCOUNT_REFUND,
              direction: 'CREDIT',
              amountCents: funding.amountCents,
              entryType: 'REFUND',
              referenceId: funding.id,
            },
          ],
        });
        refunded = true;
      } else if (funding !== null && funding.status === 'PENDING') {
        // Nie bestätigt → als fehlgeschlagen markieren (kein Geldfluss).
        await tx.challengeFunding.update({ where: { id: funding.id }, data: { status: 'FAILED' } });
      }

      await tx.challenge.update({ where: { id: challengeId }, data: { status: 'CANCELLED' } });

      await writeAudit(tx, {
        actorType: isAdmin ? 'ADMIN' : 'USER',
        actorId,
        action: 'challenge.cancelled',
        targetType: 'challenge',
        targetId: challengeId,
        before: { status: challenge.status },
        after: { status: 'CANCELLED', refunded },
      });

      return { refunded, alreadyCancelled: false };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      timeout: TRANSACTION_TIMEOUT_MS,
      maxWait: TRANSACTION_TIMEOUT_MS,
    },
  );

  if (!result.alreadyCancelled) {
    await deps.events.publish({
      type: 'challenge.cancelled',
      occurredAt: now,
      payload: { challengeId, refunded: result.refunded },
    });
  }

  return { challengeId, status: 'CANCELLED', refunded: result.refunded, alreadyCancelled: result.alreadyCancelled };
}
