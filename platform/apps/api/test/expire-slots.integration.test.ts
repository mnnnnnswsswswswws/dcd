import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { expireSlots } from '../src/workers/expire-slots.js';
import { joinChallenge } from '../src/challenges/join-challenge.js';
import { InMemoryEventPublisher } from '../src/events/event-publisher.js';
import { resetDb } from './reset-db.js';

/**
 * Integrationstest für den Slot-Expiration-Worker.
 *
 * Voraussetzung: laufende PostgreSQL (docker compose up -d) mit angewandtem Schema
 * und gesetztem DATABASE_URL.
 */
const prisma = new PrismaClient();

async function reset(): Promise<void> {
  await resetDb(prisma);
}

async function seedChallenge(status: 'OPEN' | 'FULL' = 'OPEN') {
  const creator = await prisma.user.create({ data: { isAdult: true } });
  const challenge = await prisma.challenge.create({
    data: {
      creatorId: creator.id,
      status,
      selectionMode: 'CREATOR_DECIDES',
      prizeAmountCents: 10_000,
      maxSlots: 10,
      submissionDeadline: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  return challenge;
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

describe('expireSlots', () => {
  it('gibt abgelaufene Reservierungen frei und öffnet eine volle Challenge wieder', async () => {
    const events = new InMemoryEventPublisher();
    const challenge = await seedChallenge('OPEN');

    // 10 Teilnehmer treten regulär bei -> Challenge wird FULL.
    const participants = await Promise.all(
      Array.from({ length: 10 }, () => prisma.user.create({ data: { isAdult: true } })),
    );
    for (const p of participants) {
      await joinChallenge({ prisma, events }, { challengeId: challenge.id, userId: p.id });
    }
    const full = await prisma.challenge.findUniqueOrThrow({ where: { id: challenge.id } });
    expect(full.status).toBe('FULL');

    // Ablauf simulieren: expires_at in die Vergangenheit setzen.
    await prisma.slot.updateMany({
      where: { challengeId: challenge.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const sweep = new InMemoryEventPublisher();
    const result = await expireSlots({ prisma, events: sweep });

    expect(result.expiredSlotCount).toBe(10);
    expect(result.reopenedChallengeIds).toContain(challenge.id);

    const after = await prisma.challenge.findUniqueOrThrow({ where: { id: challenge.id } });
    expect(after.status).toBe('OPEN');

    const counting = await prisma.slot.count({
      where: { challengeId: challenge.id, status: { in: ['RESERVED', 'CAPTURING', 'UPLOADING', 'SUBMITTED'] } },
    });
    expect(counting).toBe(0);

    // Events: einmal slots_expired + einmal reopened.
    expect(sweep.events.map((e) => e.type).sort()).toEqual(
      ['challenge.reopened', 'challenge.slots_expired'].sort(),
    );
  });

  it('lässt nicht abgelaufene Reservierungen unberührt', async () => {
    const events = new InMemoryEventPublisher();
    const challenge = await seedChallenge('OPEN');
    const user = await prisma.user.create({ data: { isAdult: true } });

    // Lange TTL -> läuft im Sweep nicht ab.
    await joinChallenge(
      { prisma, events, reservationTtlMs: 60 * 60 * 1000 },
      { challengeId: challenge.id, userId: user.id },
    );

    const result = await expireSlots({ prisma, events });
    expect(result.expiredSlotCount).toBe(0);
    expect(result.processedChallengeIds).toHaveLength(0);

    const counting = await prisma.slot.count({
      where: { challengeId: challenge.id, status: { in: ['RESERVED', 'CAPTURING', 'UPLOADING', 'SUBMITTED'] } },
    });
    expect(counting).toBe(1);
  });

  it('nach Freigabe kann der freie Platz erneut vergeben werden', async () => {
    const events = new InMemoryEventPublisher();
    const challenge = await seedChallenge('OPEN');

    const participants = await Promise.all(
      Array.from({ length: 10 }, () => prisma.user.create({ data: { isAdult: true } })),
    );
    for (const p of participants) {
      await joinChallenge({ prisma, events }, { challengeId: challenge.id, userId: p.id });
    }

    // Ablauf simulieren und sweepen.
    await prisma.slot.updateMany({
      where: { challengeId: challenge.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    await expireSlots({ prisma, events });

    // Neuer Teilnehmer bekommt jetzt wieder einen Platz.
    const newcomer = await prisma.user.create({ data: { isAdult: true } });
    const joined = await joinChallenge(
      { prisma, events },
      { challengeId: challenge.id, userId: newcomer.id },
    );
    expect(joined.slot.status).toBe('RESERVED');
    expect(joined.challengeStatus).toBe('OPEN');
  });
});
