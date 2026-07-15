import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient, type ChallengeStatus } from '@prisma/client';
import { apiError } from '@vcp/contracts';
import type { EventPublisher } from '../events/event-publisher.js';

const TRANSACTION_TIMEOUT_MS = 20_000;

export interface ProcessPayoutDeps {
  prisma: PrismaClient;
  events: EventPublisher;
  now?: () => Date;
}

export interface ProcessPayoutInput {
  challengeId: string;
  isAdmin: boolean;
  /** Aus dem Env-Flag `PAYOUTS_ENABLED`. Ist es false, wird nur zurückgehalten. */
  payoutsEnabled: boolean;
}

export interface ProcessPayoutResult {
  challengeId: string;
  status: 'PENDING' | 'HELD' | 'PAID';
  paid: boolean;
  alreadyPaid: boolean;
}

interface LockedChallengeRow {
  id: string;
  status: ChallengeStatus;
}

/**
 * Führt die idempotente Auszahlung an den Gewinner aus. Geld bewegt sich nur, wenn
 * `PAYOUTS_ENABLED=true`; andernfalls wird der Payout auf `HELD` gesetzt und die
 * Challenge bleibt `WINNER_LOCKED` (kein Geldfluss). Erfordert Admin-Rechte.
 */
export async function processPayout(
  deps: ProcessPayoutDeps,
  input: ProcessPayoutInput,
): Promise<ProcessPayoutResult> {
  if (!input.isAdmin) {
    throw apiError('NOT_ADMIN');
  }
  const now = deps.now?.() ?? new Date();
  const { challengeId, payoutsEnabled } = input;

  const result = await deps.prisma.$transaction(
    async (tx) => {
      const payout = await tx.payout.findUnique({ where: { challengeId } });
      if (payout === null) {
        throw apiError('CHALLENGE_INVALID_STATE');
      }
      if (payout.status === 'PAID') {
        return { status: 'PAID' as const, paid: false, alreadyPaid: true };
      }

      const locked = await tx.$queryRaw<LockedChallengeRow[]>(Prisma.sql`
        SELECT id, status FROM challenges WHERE id = ${challengeId}::uuid FOR UPDATE
      `);
      const challenge = locked[0];
      if (challenge === undefined) {
        throw apiError('CHALLENGE_NOT_FOUND');
      }
      if (challenge.status !== 'WINNER_LOCKED') {
        throw apiError('CHALLENGE_INVALID_STATE');
      }

      if (!payoutsEnabled) {
        // Kein Geldfluss: nur zurückhalten.
        if (payout.status !== 'HELD') {
          await tx.payout.update({ where: { id: payout.id }, data: { status: 'HELD' } });
        }
        return { status: 'HELD' as const, paid: false, alreadyPaid: false };
      }

      await tx.payout.update({
        where: { id: payout.id },
        data: { status: 'PAID', paidAt: now, providerRef: `po_${randomUUID()}` },
      });
      await tx.challenge.update({ where: { id: challengeId }, data: { status: 'PAID_OUT' } });
      return { status: 'PAID' as const, paid: true, alreadyPaid: false };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      timeout: TRANSACTION_TIMEOUT_MS,
      maxWait: TRANSACTION_TIMEOUT_MS,
    },
  );

  if (result.paid) {
    await deps.events.publish({
      type: 'challenge.paid_out',
      occurredAt: now,
      payload: { challengeId },
    });
  }

  return { challengeId, status: result.status, paid: result.paid, alreadyPaid: result.alreadyPaid };
}
