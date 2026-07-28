import { Prisma, PrismaClient, type ChallengeStatus } from '@prisma/client';
import { apiError } from '@vcp/contracts';
import { canTransitionChallenge } from '@vcp/domain';
import type { EventPublisher } from '../events/event-publisher.js';
import { writeAudit } from '../audit/write-audit.js';
import { writeNotification } from '../notifications/write-notification.js';
import { Aggregate, writeOutboxEvent } from '../events/outbox.js';

const TRANSACTION_TIMEOUT_MS = 20_000;

/** Buchungskonten der Escrow-Finanzierung. */
const ACCOUNT_EXTERNAL = 'EXTERNAL_FUNDING';
const ACCOUNT_ESCROW = 'CHALLENGE_ESCROW';

export interface ConfirmFundingDeps {
  prisma: PrismaClient;
  events: EventPublisher;
  now?: () => Date;
}

export interface ConfirmFundingInput {
  providerRef: string;
  amountCents: number;
}

export interface ConfirmFundingResult {
  challengeId: string;
  published: boolean;
  alreadyConfirmed: boolean;
}

interface LockedChallengeRow {
  id: string;
  status: ChallengeStatus;
}

/**
 * Bestätigt die Vollfinanzierung einer Challenge und veröffentlicht sie
 * (`PENDING_FUNDING` → `OPEN`). **Einzige** Veröffentlichungsquelle — wird
 * ausschließlich aus dem verifizierten Zahlungs-Webhook aufgerufen, nie aus einer
 * Client-Erfolgsmeldung.
 *
 * Idempotent: ein erneut zugestellter Webhook für dieselbe Zahlung ist ein No-Op.
 * Schreibt bei der ersten Bestätigung eine doppelte Buchung (immutable Ledger).
 */
export async function confirmFunding(
  deps: ConfirmFundingDeps,
  input: ConfirmFundingInput,
): Promise<ConfirmFundingResult> {
  const now = deps.now?.() ?? new Date();
  const { providerRef, amountCents } = input;

  const result = await deps.prisma.$transaction(
    async (tx) => {
      const funding = await tx.challengeFunding.findUnique({ where: { providerRef } });
      if (funding === null) {
        throw apiError('FUNDING_NOT_FOUND');
      }

      // Challenge-Row exklusiv sperren (serialisiert mit join/expire).
      const locked = await tx.$queryRaw<LockedChallengeRow[]>(Prisma.sql`
        SELECT id, status FROM challenges WHERE id = ${funding.challengeId}::uuid FOR UPDATE
      `);
      const challenge = locked[0];
      if (challenge === undefined) {
        throw apiError('CHALLENGE_NOT_FOUND');
      }

      // Idempotenz: bereits bestätigt → No-Op.
      if (funding.status === 'CONFIRMED') {
        return { challengeId: funding.challengeId, published: false, alreadyConfirmed: true };
      }
      if (funding.status !== 'PENDING') {
        throw apiError('CHALLENGE_INVALID_STATE');
      }
      if (amountCents !== funding.amountCents) {
        throw apiError('FUNDING_AMOUNT_MISMATCH');
      }
      if (!canTransitionChallenge(challenge.status, 'OPEN')) {
        throw apiError('CHALLENGE_INVALID_STATE');
      }

      await tx.challengeFunding.update({
        where: { id: funding.id },
        data: { status: 'CONFIRMED', confirmedAt: now },
      });

      // Doppelte Buchung: Zufluss extern (Soll) gegen Escrow der Challenge (Haben).
      await tx.ledgerEntry.createMany({
        data: [
          {
            challengeId: funding.challengeId,
            account: ACCOUNT_EXTERNAL,
            direction: 'DEBIT',
            amountCents: funding.amountCents,
            entryType: 'FUNDING_ESCROW',
            referenceId: funding.id,
          },
          {
            challengeId: funding.challengeId,
            account: ACCOUNT_ESCROW,
            direction: 'CREDIT',
            amountCents: funding.amountCents,
            entryType: 'FUNDING_ESCROW',
            referenceId: funding.id,
          },
        ],
      });

      await tx.challenge.update({
        where: { id: funding.challengeId },
        data: { status: 'OPEN' },
      });

      await writeAudit(tx, {
        actorType: 'SYSTEM',
        action: 'challenge.funded',
        targetType: 'challenge',
        targetId: funding.challengeId,
        before: { status: challenge.status },
        after: { status: 'OPEN', fundingId: funding.id },
      });

      // Ersteller benachrichtigen: Challenge ist jetzt öffentlich.
      const chal = await tx.challenge.findUnique({
        where: { id: funding.challengeId },
        select: { creatorId: true, title: true },
      });
      if (chal !== null) {
        await writeNotification(tx, {
          userId: chal.creatorId,
          type: 'challenge.published',
          challengeId: funding.challengeId,
          title: 'Challenge veröffentlicht',
          body: chal.title
            ? `„${chal.title}" ist jetzt offen für Teilnehmer.`
            : 'Deine Challenge ist jetzt offen für Teilnehmer.',
        });
      }

      // Outbox im selben Commit: Finanzierung bestätigt und Challenge veröffentlicht
      // sind eine Einheit — kein Event ohne Zustandswechsel und umgekehrt.
      await writeOutboxEvent(tx, {
        aggregateType: Aggregate.CHALLENGE,
        aggregateId: funding.challengeId,
        eventType: 'challenge.published',
        payload: { challengeId: funding.challengeId, fundingId: funding.id },
      });

      return { challengeId: funding.challengeId, published: true, alreadyConfirmed: false };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      timeout: TRANSACTION_TIMEOUT_MS,
      maxWait: TRANSACTION_TIMEOUT_MS,
    },
  );

  if (result.published) {
    await deps.events.publish({
      type: 'challenge.published',
      occurredAt: now,
      payload: { challengeId: result.challengeId },
    });
  }

  return result;
}
