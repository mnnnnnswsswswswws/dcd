import { PrismaClient, type SelectionMode } from '@prisma/client';
import { MockPaymentProvider } from '@vcp/payments';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createChallenge } from '../src/challenges/create-challenge.js';
import { confirmFunding } from '../src/funding/confirm-funding.js';
import { joinChallenge } from '../src/challenges/join-challenge.js';
import { submitEntry } from '../src/submissions/submit-entry.js';
import { moderateSubmission } from '../src/submissions/moderate-submission.js';
import { castVote } from '../src/submissions/cast-vote.js';
import { closeSubmissions } from '../src/challenges/close-submissions.js';
import { selectWinner } from '../src/challenges/select-winner.js';
import { processPayout } from '../src/funding/process-payout.js';
import { InMemoryEventPublisher } from '../src/events/event-publisher.js';
import { resetDb } from './reset-db.js';

/**
 * Geld-raus-Loop: Einsendung → (Votes) → Einsendeschluss → Gewinnerauswahl
 * (alle drei Quellen) → Winner-Lock → idempotente Auszahlung. Deckt Ledger-Balance,
 * Idempotenz und Nebenläufigkeit ab.
 *
 * Voraussetzung: PostgreSQL mit Schema + Immutability-Trigger, DATABASE_URL gesetzt.
 */
const prisma = new PrismaClient();
const events = new InMemoryEventPublisher();
const deps = { prisma, events };

async function makeUser(): Promise<string> {
  return (await prisma.user.create({ data: { isAdult: true } })).id;
}

/** Finanziert eine Challenge und bringt `count` Teilnehmer bis `APPROVED`. */
async function fundedWithApproved(mode: SelectionMode, count: number) {
  const payments = new MockPaymentProvider();
  const creatorId = await makeUser();
  const created = await createChallenge(
    { prisma, payments, events },
    { creatorId, title: 'Test-Challenge', selectionMode: mode, prizeAmountCents: 10_000, submissionDeadline: new Date(Date.now() + 3_600_000) },
  );
  await confirmFunding(deps, { providerRef: created.funding.providerRef, amountCents: 10_000 });

  const participants: { id: string; submissionId: string }[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = await makeUser();
    await joinChallenge(deps, { challengeId: created.challenge.id, userId: id });
    const sub = await submitEntry(deps, { challengeId: created.challenge.id, userId: id });
    await moderateSubmission(deps, { submissionId: sub.submissionId, decision: 'APPROVED', isAdmin: true });
    participants.push({ id, submissionId: sub.submissionId });
  }
  return { challengeId: created.challenge.id, creatorId, participants };
}

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await resetDb(prisma);
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDb(prisma);
});

describe('Geld-raus-Loop', () => {
  it('CREATOR_DECIDES: Ersteller wählt, Auszahlung erst bei aktiviertem Flag', async () => {
    const { challengeId, creatorId, participants } = await fundedWithApproved('CREATOR_DECIDES', 3);
    await closeSubmissions(deps, { challengeId, isAdmin: true });

    const winner = participants[1]!;
    const decision = await selectWinner(deps, {
      challengeId,
      actorId: creatorId,
      isAdmin: false,
      winnerSubmissionId: winner.submissionId,
    });
    expect(decision).toMatchObject({ winnerSubmissionId: winner.submissionId, decisionSource: 'CREATOR', alreadyDecided: false });

    // Submission-Status: genau ein WINNER, Rest LOSER.
    const winners = await prisma.submission.count({ where: { challengeId, status: 'WINNER' } });
    const losers = await prisma.submission.count({ where: { challengeId, status: 'LOSER' } });
    expect(winners).toBe(1);
    expect(losers).toBe(2);

    const locked = await prisma.challenge.findUniqueOrThrow({ where: { id: challengeId } });
    expect(locked.status).toBe('WINNER_LOCKED');

    // Payout-Ledger balanciert (Escrow-Soll == Winner-Haben == Preissumme).
    const payoutLedger = await prisma.ledgerEntry.findMany({ where: { challengeId, entryType: 'PAYOUT' } });
    expect(payoutLedger).toHaveLength(2);
    const debit = payoutLedger.filter((e) => e.direction === 'DEBIT').reduce((s, e) => s + e.amountCents, 0);
    const credit = payoutLedger.filter((e) => e.direction === 'CREDIT').reduce((s, e) => s + e.amountCents, 0);
    expect(debit).toBe(10_000);
    expect(credit).toBe(10_000);

    // Auszahlung deaktiviert → HELD, Challenge bleibt WINNER_LOCKED.
    const held = await processPayout(deps, { challengeId, isAdmin: true, payoutsEnabled: false });
    expect(held).toMatchObject({ status: 'HELD', paid: false });
    expect((await prisma.challenge.findUniqueOrThrow({ where: { id: challengeId } })).status).toBe('WINNER_LOCKED');

    // Auszahlung aktiviert → PAID, Challenge PAID_OUT; erneuter Aufruf idempotent.
    const paid = await processPayout(deps, { challengeId, isAdmin: true, payoutsEnabled: true });
    expect(paid).toMatchObject({ status: 'PAID', paid: true });
    expect((await prisma.challenge.findUniqueOrThrow({ where: { id: challengeId } })).status).toBe('PAID_OUT');
    const again = await processPayout(deps, { challengeId, isAdmin: true, payoutsEnabled: true });
    expect(again).toMatchObject({ alreadyPaid: true });

    // Audit-Log: Winner-Lock und Auszahlung revisionssicher protokolliert.
    const actions = (await prisma.auditLog.findMany({ where: { targetId: challengeId } })).map((a) => a.action);
    expect(actions).toContain('challenge.winner_locked');
    expect(actions).toContain('challenge.paid_out');
  });

  it('COMMUNITY_VOTE: höchster Score gewinnt', async () => {
    const { challengeId, participants } = await fundedWithApproved('COMMUNITY_VOTE', 3);
    // participants[2] erhält 2 Stimmen, participants[0] eine.
    for (let i = 0; i < 2; i += 1) {
      const voter = await makeUser();
      await castVote(deps, { challengeId, submissionId: participants[2]!.submissionId, voterId: voter });
    }
    const voter = await makeUser();
    await castVote(deps, { challengeId, submissionId: participants[0]!.submissionId, voterId: voter });

    await closeSubmissions(deps, { challengeId, isAdmin: true });
    const decision = await selectWinner(deps, { challengeId, actorId: await makeUser(), isAdmin: true });
    expect(decision).toMatchObject({ winnerSubmissionId: participants[2]!.submissionId, decisionSource: 'COMMUNITY_VOTE' });
  });

  it('AUTO_FALLBACK: bei CREATOR_DECIDES löst Admin den Community-Fallback aus', async () => {
    const { challengeId, participants } = await fundedWithApproved('CREATOR_DECIDES', 2);
    const voter = await makeUser();
    await castVote(deps, { challengeId, submissionId: participants[1]!.submissionId, voterId: voter });

    await closeSubmissions(deps, { challengeId, isAdmin: true });
    const decision = await selectWinner(deps, { challengeId, actorId: await makeUser(), isAdmin: true });
    expect(decision).toMatchObject({ winnerSubmissionId: participants[1]!.submissionId, decisionSource: 'AUTO_FALLBACK' });
  });

  it('lehnt Auswahl ohne gewinnberechtigte Einsendung ab', async () => {
    const payments = new MockPaymentProvider();
    const creatorId = await makeUser();
    const created = await createChallenge(
      { prisma, payments, events },
      { creatorId, title: 'Test-Challenge', selectionMode: 'CREATOR_DECIDES', prizeAmountCents: 5_000, submissionDeadline: new Date(Date.now() + 3_600_000) },
    );
    await confirmFunding(deps, { providerRef: created.funding.providerRef, amountCents: 5_000 });
    await closeSubmissions(deps, { challengeId: created.challenge.id, isAdmin: true });
    await expect(
      selectWinner(deps, { challengeId: created.challenge.id, actorId: creatorId, isAdmin: true }),
    ).rejects.toMatchObject({ code: 'NO_ELIGIBLE_SUBMISSIONS' });
  });

  it('ist nebenläufigkeitssicher: zwei parallele Auswahlen → genau eine Decision', async () => {
    const { challengeId, creatorId, participants } = await fundedWithApproved('CREATOR_DECIDES', 3);
    await closeSubmissions(deps, { challengeId, isAdmin: true });

    const win = participants[0]!.submissionId;
    const [a, b] = await Promise.all([
      selectWinner(deps, { challengeId, actorId: creatorId, isAdmin: false, winnerSubmissionId: win }),
      selectWinner(deps, { challengeId, actorId: creatorId, isAdmin: false, winnerSubmissionId: win }),
    ]);
    // Beide liefern denselben Gewinner; genau eine hat neu entschieden.
    expect(a.winnerSubmissionId).toBe(win);
    expect(b.winnerSubmissionId).toBe(win);
    expect([a.alreadyDecided, b.alreadyDecided].filter((x) => x === false)).toHaveLength(1);

    const decisions = await prisma.winnerDecision.count({ where: { challengeId } });
    expect(decisions).toBe(1);
    const payoutEntries = await prisma.ledgerEntry.count({ where: { challengeId, entryType: 'PAYOUT' } });
    expect(payoutEntries).toBe(2);
  });
});
