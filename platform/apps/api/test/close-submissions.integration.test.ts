import { PrismaClient } from '@prisma/client';
import { MockPaymentProvider } from '@vcp/payments';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createChallenge } from '../src/challenges/create-challenge.js';
import { confirmFunding } from '../src/funding/confirm-funding.js';
import { closeExpiredSubmissions } from '../src/workers/close-expired-submissions.js';
import { InMemoryEventPublisher } from '../src/events/event-publisher.js';
import { resetDb } from './reset-db.js';

/** Fristen-Worker: schließt abgelaufene Challenges automatisch. */
const prisma = new PrismaClient();
const events = new InMemoryEventPublisher();

async function fundedOpenChallenge(deadline: Date): Promise<string> {
  const payments = new MockPaymentProvider();
  const creator = await prisma.user.create({ data: { isAdult: true } });
  const created = await createChallenge(
    { prisma, payments, events },
    { creatorId: creator.id, selectionMode: 'CREATOR_DECIDES', prizeAmountCents: 10_000, submissionDeadline: deadline },
  );
  await confirmFunding({ prisma, events }, { providerRef: created.funding.providerRef, amountCents: 10_000 });
  return created.challenge.id;
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

describe('closeExpiredSubmissions', () => {
  it('schließt abgelaufene und lässt laufende Challenges unberührt', async () => {
    // createChallenge verlangt eine zukünftige Frist; danach in die Vergangenheit setzen.
    const expired = await fundedOpenChallenge(new Date(Date.now() + 3_600_000));
    await prisma.challenge.update({
      where: { id: expired },
      data: { submissionDeadline: new Date(Date.now() - 60_000) },
    });
    const active = await fundedOpenChallenge(new Date(Date.now() + 3_600_000));

    const result = await closeExpiredSubmissions({ prisma, events });

    expect(result.closedChallengeIds).toContain(expired);
    expect(result.closedChallengeIds).not.toContain(active);
    expect((await prisma.challenge.findUniqueOrThrow({ where: { id: expired } })).status).toBe('SUBMISSIONS_CLOSED');
    expect((await prisma.challenge.findUniqueOrThrow({ where: { id: active } })).status).toBe('OPEN');
  });

  it('ist idempotent', async () => {
    const expired = await fundedOpenChallenge(new Date(Date.now() + 3_600_000));
    await prisma.challenge.update({
      where: { id: expired },
      data: { submissionDeadline: new Date(Date.now() - 60_000) },
    });
    await closeExpiredSubmissions({ prisma, events });
    const second = await closeExpiredSubmissions({ prisma, events });
    expect(second.closedChallengeIds).toHaveLength(0);
  });
});
