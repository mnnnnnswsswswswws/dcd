import { Prisma, PrismaClient, type ChallengeStatus, type SelectionMode } from '@prisma/client';
import { apiError } from '@vcp/contracts';
import { DecisionSource, canTransitionChallenge } from '@vcp/domain';
import type { EventPublisher } from '../events/event-publisher.js';

const TRANSACTION_TIMEOUT_MS = 20_000;
const ACCOUNT_ESCROW = 'CHALLENGE_ESCROW';
const ACCOUNT_WINNER = 'WINNER_PAYABLE';

export interface SelectWinnerDeps {
  prisma: PrismaClient;
  events: EventPublisher;
  now?: () => Date;
}

export interface SelectWinnerInput {
  challengeId: string;
  actorId: string;
  isAdmin: boolean;
  /** Nur für CREATOR_DECIDES durch den Ersteller: die gewählte Einsendung. */
  winnerSubmissionId?: string;
}

export interface SelectWinnerResult {
  challengeId: string;
  winnerSubmissionId: string;
  decisionSource: DecisionSource;
  alreadyDecided: boolean;
}

interface LockedChallengeRow {
  id: string;
  creator_id: string;
  status: ChallengeStatus;
  selection_mode: SelectionMode;
  prize_amount_cents: number;
}

interface ApprovedSubmission {
  id: string;
  finalizedAt: Date | null;
  createdAt: Date;
}

/**
 * Wählt den Gewinner atomar und unveränderlich aus (Rules 4–7):
 *
 * - Genau eine Winner-Decision pro Challenge (`UNIQUE(challenge_id)`); erneuter
 *   Aufruf ist idempotent.
 * - Ablauf in einer Transaktion (Row-Lock): prüfen → Decision → Submissions
 *   WINNER/LOSER → Challenge `WINNER_LOCKED` → Payout-Datensatz → doppelte
 *   Ledger-Buchung (Escrow → Winner-Payable).
 * - `CREATOR_DECIDES`: Ersteller wählt eine `APPROVED`-Einsendung; bei Untätigkeit
 *   löst ein Admin den Fallback aus (höchster Community-Score, Tie-Break früheste
 *   `finalized_at`, `decision_source = AUTO_FALLBACK`).
 * - `COMMUNITY_VOTE`: höchster Community-Score entscheidet.
 */
export async function selectWinner(
  deps: SelectWinnerDeps,
  input: SelectWinnerInput,
): Promise<SelectWinnerResult> {
  const now = deps.now?.() ?? new Date();
  const { challengeId, actorId, isAdmin, winnerSubmissionId } = input;

  const result = await deps.prisma.$transaction(
    async (tx) => {
      const locked = await tx.$queryRaw<LockedChallengeRow[]>(Prisma.sql`
        SELECT id, creator_id, status, selection_mode, prize_amount_cents
        FROM challenges WHERE id = ${challengeId}::uuid FOR UPDATE
      `);
      const challenge = locked[0];
      if (challenge === undefined) {
        throw apiError('CHALLENGE_NOT_FOUND');
      }

      // Idempotenz: bereits entschieden.
      const existing = await tx.winnerDecision.findUnique({ where: { challengeId } });
      if (existing !== null) {
        return {
          challengeId,
          winnerSubmissionId: existing.winnerSubmissionId ?? '',
          decisionSource: existing.decisionSource as DecisionSource,
          alreadyDecided: true,
        };
      }

      if (!canTransitionChallenge(challenge.status, 'WINNER_LOCKED')) {
        throw apiError('CHALLENGE_INVALID_STATE');
      }

      const isCreator = challenge.creator_id === actorId;
      if (!isCreator && !isAdmin) {
        throw apiError('NOT_ADMIN');
      }

      const approved = await tx.submission.findMany({
        where: { challengeId, status: 'APPROVED' },
        select: { id: true, finalizedAt: true, createdAt: true },
      });
      if (approved.length === 0) {
        throw apiError('NO_ELIGIBLE_SUBMISSIONS');
      }

      // Gewinner + Entscheidungsquelle bestimmen.
      let winnerId: string;
      let decisionSource: DecisionSource;

      if (challenge.selection_mode === 'CREATOR_DECIDES') {
        if (isCreator && winnerSubmissionId !== undefined) {
          const chosen = approved.find((s) => s.id === winnerSubmissionId);
          if (chosen === undefined) {
            throw apiError('SUBMISSION_NOT_ELIGIBLE');
          }
          winnerId = chosen.id;
          decisionSource = DecisionSource.CREATOR;
        } else if (isAdmin) {
          winnerId = await pickByCommunityScore(tx, challengeId, approved);
          decisionSource = DecisionSource.AUTO_FALLBACK;
        } else {
          // Ersteller ohne Auswahl.
          throw apiError('INVALID_INPUT');
        }
      } else {
        winnerId = await pickByCommunityScore(tx, challengeId, approved);
        decisionSource = DecisionSource.COMMUNITY_VOTE;
      }

      await tx.winnerDecision.create({
        data: { challengeId, winnerSubmissionId: winnerId, decisionSource },
      });

      await tx.submission.update({ where: { id: winnerId }, data: { status: 'WINNER' } });
      await tx.submission.updateMany({
        where: { challengeId, status: 'APPROVED', id: { not: winnerId } },
        data: { status: 'LOSER' },
      });

      const payout = await tx.payout.create({
        data: {
          challengeId,
          submissionId: winnerId,
          amountCents: challenge.prize_amount_cents,
          status: 'PENDING',
          idempotencyKey: `payout:${challengeId}`,
        },
      });

      // Doppelte Buchung: Escrow (Soll) gegen Winner-Payable (Haben).
      await tx.ledgerEntry.createMany({
        data: [
          {
            challengeId,
            account: ACCOUNT_ESCROW,
            direction: 'DEBIT',
            amountCents: challenge.prize_amount_cents,
            entryType: 'PAYOUT',
            referenceId: payout.id,
          },
          {
            challengeId,
            account: ACCOUNT_WINNER,
            direction: 'CREDIT',
            amountCents: challenge.prize_amount_cents,
            entryType: 'PAYOUT',
            referenceId: payout.id,
          },
        ],
      });

      await tx.challenge.update({ where: { id: challengeId }, data: { status: 'WINNER_LOCKED' } });

      return { challengeId, winnerSubmissionId: winnerId, decisionSource, alreadyDecided: false };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      timeout: TRANSACTION_TIMEOUT_MS,
      maxWait: TRANSACTION_TIMEOUT_MS,
    },
  );

  if (!result.alreadyDecided) {
    await deps.events.publish({
      type: 'challenge.winner_locked',
      occurredAt: now,
      payload: {
        challengeId,
        winnerSubmissionId: result.winnerSubmissionId,
        decisionSource: result.decisionSource,
      },
    });
  }

  return result;
}

/**
 * Höchster Community-Score unter den freigegebenen Einsendungen; Tie-Break früheste
 * `finalizedAt`, dann früheste `createdAt`. Ohne Stimmen zählt jede Einsendung als 0
 * und die früheste finalisierte gewinnt.
 */
async function pickByCommunityScore(
  tx: Prisma.TransactionClient,
  challengeId: string,
  approved: ApprovedSubmission[],
): Promise<string> {
  const counts = await tx.vote.groupBy({
    by: ['submissionId'],
    where: { challengeId, submissionId: { in: approved.map((s) => s.id) } },
    _count: { _all: true },
  });
  const scoreById = new Map<string, number>();
  for (const row of counts) {
    scoreById.set(row.submissionId, row._count._all);
  }

  const ranked = [...approved].sort((a, b) => {
    const scoreDiff = (scoreById.get(b.id) ?? 0) - (scoreById.get(a.id) ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    const aFinal = a.finalizedAt?.getTime() ?? a.createdAt.getTime();
    const bFinal = b.finalizedAt?.getTime() ?? b.createdAt.getTime();
    if (aFinal !== bFinal) return aFinal - bFinal;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  // ranked[0] existiert, da approved nicht leer ist.
  return ranked[0]!.id;
}
