import { PrismaClient } from '@prisma/client';
import { MockPaymentProvider } from '@vcp/payments';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createChallenge } from '../src/challenges/create-challenge.js';
import { confirmFunding } from '../src/funding/confirm-funding.js';
import { joinChallenge } from '../src/challenges/join-challenge.js';
import { cancelChallenge } from '../src/challenges/cancel-challenge.js';
import { InMemoryEventPublisher } from '../src/events/event-publisher.js';
import { resetDb } from './reset-db.js';

/** Abbruch + idempotente Erstattung (Refund-Verzweigung des Geldflusses). */
const prisma = new PrismaClient();
const events = new InMemoryEventPublisher();
const deps = { prisma, events };

async function makeUser(): Promise<string> {
  return (await prisma.user.create({ data: { isAdult: true } })).id;
}

async function createFunded() {
  const payments = new MockPaymentProvider();
  const creatorId = await makeUser();
  const created = await createChallenge(
    { prisma, payments, events },
    { creatorId, title: 'Test-Challenge', selectionMode: 'CREATOR_DECIDES', prizeAmountCents: 10_000, submissionDeadline: new Date(Date.now() + 3_600_000) },
  );
  await confirmFunding(deps, { providerRef: created.funding.providerRef, amountCents: 10_000 });
  return { challengeId: created.challenge.id, creatorId, providerRef: created.funding.providerRef };
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

describe('cancelChallenge', () => {
  it('erstattet eine vollfinanzierte Challenge, gibt Plätze frei, ist idempotent', async () => {
    const { challengeId, creatorId } = await createFunded();
    const participant = await makeUser();
    await joinChallenge(deps, { challengeId, userId: participant });

    const res = await cancelChallenge(deps, { challengeId, actorId: creatorId, isAdmin: false });
    expect(res).toMatchObject({ status: 'CANCELLED', refunded: true, alreadyCancelled: false });

    // Challenge abgebrochen, Funding erstattet.
    expect((await prisma.challenge.findUniqueOrThrow({ where: { id: challengeId } })).status).toBe('CANCELLED');
    expect((await prisma.challengeFunding.findUniqueOrThrow({ where: { challengeId } })).status).toBe('REFUNDED');

    // Zählende Slots freigegeben.
    const counting = await prisma.slot.count({
      where: { challengeId, status: { in: ['RESERVED', 'CAPTURING', 'UPLOADING', 'SUBMITTED'] } },
    });
    expect(counting).toBe(0);

    // Refund-Ledger balanciert.
    const refund = await prisma.ledgerEntry.findMany({ where: { challengeId, entryType: 'REFUND' } });
    expect(refund).toHaveLength(2);
    const debit = refund.filter((e) => e.direction === 'DEBIT').reduce((s, e) => s + e.amountCents, 0);
    const credit = refund.filter((e) => e.direction === 'CREDIT').reduce((s, e) => s + e.amountCents, 0);
    expect(debit).toBe(10_000);
    expect(credit).toBe(10_000);

    // Beitritt nach Abbruch nicht möglich.
    await expect(
      joinChallenge(deps, { challengeId, userId: await makeUser() }),
    ).rejects.toMatchObject({ code: 'CHALLENGE_NOT_JOINABLE' });

    // Idempotenz: zweiter Abbruch ist No-Op, keine zusätzlichen Buchungen.
    const second = await cancelChallenge(deps, { challengeId, actorId: creatorId, isAdmin: false });
    expect(second).toMatchObject({ alreadyCancelled: true, refunded: false });
    expect(await prisma.ledgerEntry.count({ where: { challengeId, entryType: 'REFUND' } })).toBe(2);
  });

  it('bricht eine noch nicht finanzierte Challenge ohne Erstattung ab', async () => {
    const payments = new MockPaymentProvider();
    const creatorId = await makeUser();
    const created = await createChallenge(
      { prisma, payments, events },
      { creatorId, title: 'Test-Challenge', selectionMode: 'CREATOR_DECIDES', prizeAmountCents: 5_000, submissionDeadline: new Date(Date.now() + 3_600_000) },
    );
    const res = await cancelChallenge(deps, { challengeId: created.challenge.id, actorId: creatorId, isAdmin: false });
    expect(res).toMatchObject({ refunded: false });
    expect((await prisma.challengeFunding.findUniqueOrThrow({ where: { challengeId: created.challenge.id } })).status).toBe('FAILED');
    expect(await prisma.ledgerEntry.count({ where: { challengeId: created.challenge.id, entryType: 'REFUND' } })).toBe(0);
  });

  it('lehnt Abbruch durch Fremde ab (403 FORBIDDEN)', async () => {
    const { challengeId } = await createFunded();
    await expect(
      cancelChallenge(deps, { challengeId, actorId: await makeUser(), isAdmin: false }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('erlaubt Abbruch durch einen Admin', async () => {
    const { challengeId } = await createFunded();
    const res = await cancelChallenge(deps, { challengeId, actorId: await makeUser(), isAdmin: true });
    expect(res.status).toBe('CANCELLED');
  });
});
