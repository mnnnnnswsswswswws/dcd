import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '@vcp/contracts';
import { joinChallenge } from '../src/challenges/join-challenge.js';
import { InMemoryEventPublisher } from '../src/events/event-publisher.js';
import { resetDb } from './reset-db.js';

/**
 * Pflichttest (Definition of Done) für `joinChallenge`.
 *
 * 50 parallele authentifizierte Join-Requests gegen eine Challenge mit 10 Plätzen:
 *   → exakt 10 Erfolge,
 *   → 40 × CHALLENGE_FULL,
 *   → keine doppelte Reservierung,
 *   → Challenge-Status FULL,
 *   → Daten konsistent.
 *
 * Voraussetzung: laufende PostgreSQL (docker compose up -d) mit angewandtem Schema
 * (prisma migrate deploy / db push) und gesetztem DATABASE_URL.
 */
const prisma = new PrismaClient();

async function reset(): Promise<void> {
  await resetDb(prisma);
}

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await reset();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
});

describe('joinChallenge — Concurrency', () => {
  it('vergibt bei 50 parallelen Requests exakt 10 Plätze', async () => {
    const events = new InMemoryEventPublisher();

    const creator = await prisma.user.create({ data: { isAdult: true } });
    const challenge = await prisma.challenge.create({
      data: {
        creatorId: creator.id,
        status: 'OPEN',
        selectionMode: 'CREATOR_DECIDES',
        prizeAmountCents: 10_000,
        maxSlots: 10,
        submissionDeadline: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const participants = await Promise.all(
      Array.from({ length: 50 }, () => prisma.user.create({ data: { isAdult: true } })),
    );

    const outcomes = await Promise.allSettled(
      participants.map((participant) =>
        joinChallenge({ prisma, events }, { challengeId: challenge.id, userId: participant.id }),
      ),
    );

    const succeeded = outcomes.filter((o) => o.status === 'fulfilled');
    const failed = outcomes.filter(
      (o): o is PromiseRejectedResult => o.status === 'rejected',
    );

    // Exakt 10 Erfolge, 40 Fehlschläge, alle mit CHALLENGE_FULL.
    expect(succeeded).toHaveLength(10);
    expect(failed).toHaveLength(40);
    for (const failure of failed) {
      expect(failure.reason).toBeInstanceOf(AppError);
      expect((failure.reason as AppError).code).toBe('CHALLENGE_FULL');
    }

    // Genau 10 zählende Slots, alle mit unterschiedlichem Teilnehmer.
    const slots = await prisma.slot.findMany({ where: { challengeId: challenge.id } });
    const counting = slots.filter((s) =>
      ['RESERVED', 'CAPTURING', 'UPLOADING', 'SUBMITTED'].includes(s.status),
    );
    expect(counting).toHaveLength(10);
    const participantIds = new Set(counting.map((s) => s.participantId));
    expect(participantIds.size).toBe(10);

    // Challenge ist FULL.
    const after = await prisma.challenge.findUniqueOrThrow({ where: { id: challenge.id } });
    expect(after.status).toBe('FULL');

    // Für jede erfolgreiche Reservierung genau ein Event.
    expect(events.events).toHaveLength(10);
    expect(events.events.every((e) => e.type === 'challenge.slot_reserved')).toBe(true);
  });

  it('lehnt den Ersteller ab', async () => {
    const events = new InMemoryEventPublisher();
    const creator = await prisma.user.create({ data: { isAdult: true } });
    const challenge = await prisma.challenge.create({
      data: {
        creatorId: creator.id,
        status: 'OPEN',
        selectionMode: 'CREATOR_DECIDES',
        prizeAmountCents: 10_000,
        maxSlots: 10,
      },
    });

    await expect(
      joinChallenge({ prisma, events }, { challengeId: challenge.id, userId: creator.id }),
    ).rejects.toMatchObject({ code: 'CREATOR_CANNOT_JOIN' });
  });

  it('lehnt doppelten Beitritt desselben Nutzers ab', async () => {
    const events = new InMemoryEventPublisher();
    const creator = await prisma.user.create({ data: { isAdult: true } });
    const user = await prisma.user.create({ data: { isAdult: true } });
    const challenge = await prisma.challenge.create({
      data: {
        creatorId: creator.id,
        status: 'OPEN',
        selectionMode: 'CREATOR_DECIDES',
        prizeAmountCents: 10_000,
        maxSlots: 10,
      },
    });

    await joinChallenge({ prisma, events }, { challengeId: challenge.id, userId: user.id });
    await expect(
      joinChallenge({ prisma, events }, { challengeId: challenge.id, userId: user.id }),
    ).rejects.toMatchObject({ code: 'ALREADY_JOINED' });

    const counting = await prisma.slot.count({
      where: { challengeId: challenge.id, status: { in: ['RESERVED', 'CAPTURING', 'UPLOADING', 'SUBMITTED'] } },
    });
    expect(counting).toBe(1);
  });
});
