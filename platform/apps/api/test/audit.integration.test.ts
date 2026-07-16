import { PrismaClient } from '@prisma/client';
import { MockPaymentProvider } from '@vcp/payments';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createChallenge } from '../src/challenges/create-challenge.js';
import { confirmFunding } from '../src/funding/confirm-funding.js';
import { cancelChallenge } from '../src/challenges/cancel-challenge.js';
import { InMemoryEventPublisher } from '../src/events/event-publisher.js';
import { resetDb } from './reset-db.js';

/** Revisionssicheres Audit-Log: Einträge bei Zustandsänderungen + Unveränderlichkeit. */
const prisma = new PrismaClient();
const events = new InMemoryEventPublisher();
const deps = { prisma, events };

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

async function createFunded() {
  const payments = new MockPaymentProvider();
  const creatorId = (await prisma.user.create({ data: { isAdult: true } })).id;
  const created = await createChallenge(
    { prisma, payments, events },
    { creatorId, selectionMode: 'CREATOR_DECIDES', prizeAmountCents: 10_000, submissionDeadline: new Date(Date.now() + 3_600_000) },
  );
  await confirmFunding(deps, { providerRef: created.funding.providerRef, amountCents: 10_000 });
  return { challengeId: created.challenge.id, creatorId };
}

describe('audit_logs', () => {
  it('protokolliert Finanzierung und Abbruch atomar', async () => {
    const { challengeId, creatorId } = await createFunded();

    const funded = await prisma.auditLog.findMany({ where: { targetId: challengeId, action: 'challenge.funded' } });
    expect(funded).toHaveLength(1);
    expect(funded[0]!.actorType).toBe('SYSTEM');
    expect((funded[0]!.afterJson as { status?: string }).status).toBe('OPEN');

    await cancelChallenge(deps, { challengeId, actorId: creatorId, isAdmin: false });
    const cancelled = await prisma.auditLog.findMany({ where: { targetId: challengeId, action: 'challenge.cancelled' } });
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]!.actorType).toBe('USER');
    expect(cancelled[0]!.actorId).toBe(creatorId);
  });

  it('erzwingt Unveränderlichkeit (DB-Trigger lehnt UPDATE/DELETE ab)', async () => {
    const { challengeId } = await createFunded();
    await expect(
      prisma.auditLog.updateMany({ where: { targetId: challengeId }, data: { action: 'tampered' } }),
    ).rejects.toThrow();
    await expect(prisma.auditLog.deleteMany({ where: { targetId: challengeId } })).rejects.toThrow();
  });
});
