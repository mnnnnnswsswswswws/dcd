import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { confirmFunding } from '../src/funding/confirm-funding.js';
import { moderateSubmission } from '../src/submissions/moderate-submission.js';
import { InMemoryEventPublisher } from '../src/events/event-publisher.js';
import { resetDb } from './reset-db.js';

/** Benachrichtigungen entstehen atomar aus den auslösenden Zustandsänderungen. */
const prisma = new PrismaClient();

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

describe('Benachrichtigungen', () => {
  it('Veröffentlichung benachrichtigt den Ersteller', async () => {
    const events = new InMemoryEventPublisher();
    const creator = await prisma.user.create({ data: { isAdult: true } });
    const challenge = await prisma.challenge.create({
      data: {
        creatorId: creator.id,
        title: 'Bester Wurf',
        status: 'PENDING_FUNDING',
        selectionMode: 'CREATOR_DECIDES',
        prizeAmountCents: 10_000,
        maxSlots: 10,
      },
    });
    await prisma.challengeFunding.create({
      data: { challengeId: challenge.id, provider: 'mock', providerRef: 'ref-1', amountCents: 10_000, status: 'PENDING', idempotencyKey: 'fund:ref-1' },
    });

    await confirmFunding({ prisma, events }, { providerRef: 'ref-1', amountCents: 10_000 });

    const notes = await prisma.notification.findMany({ where: { userId: creator.id } });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ type: 'challenge.published', challengeId: challenge.id });
    expect(notes[0]?.body).toContain('Bester Wurf');
  });

  it('Moderation benachrichtigt den Teilnehmer (freigegeben/abgelehnt)', async () => {
    const events = new InMemoryEventPublisher();
    const creator = await prisma.user.create({ data: { isAdult: true } });
    const challenge = await prisma.challenge.create({
      data: { creatorId: creator.id, status: 'OPEN', selectionMode: 'CREATOR_DECIDES', prizeAmountCents: 5_000, maxSlots: 10 },
    });
    const participant = await prisma.user.create({ data: { isAdult: true } });
    const submission = await prisma.submission.create({
      data: { challengeId: challenge.id, participantId: participant.id, status: 'SUBMITTED' },
    });

    await moderateSubmission({ prisma, events }, { submissionId: submission.id, decision: 'APPROVED', isAdmin: true });

    const notes = await prisma.notification.findMany({ where: { userId: participant.id } });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ type: 'submission.approved', challengeId: challenge.id });
  });
});
