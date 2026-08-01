import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '@vcp/contracts';
import { joinChallenge } from '../src/challenges/join-challenge.js';
import { InMemoryEventPublisher } from '../src/events/event-publisher.js';
import { resetDb } from './reset-db.js';

/**
 * Beweist die eigentliche Zusage der Transactional Outbox (Architekturregel 4):
 * Event und Zustandsänderung liegen im **selben** Commit.
 *
 * Der aussagekräftige Fall ist nicht der Erfolg, sondern der Abbruch: Scheitert die
 * Domänen-Transaktion, darf auch kein Outbox-Event zurückbleiben. Genau das kann ein
 * nachgelagerter `publish()`-Aufruf nicht garantieren — und genau deshalb gibt es
 * die Outbox.
 */
const prisma = new PrismaClient();

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDb(prisma);
});

async function seedOpenChallenge(maxSlots = 10): Promise<{ challengeId: string; creatorId: string }> {
  const creator = await prisma.user.create({ data: { isAdult: true } });
  const challenge = await prisma.challenge.create({
    data: {
      creatorId: creator.id,
      title: 'Outbox-Kopplungstest',
      status: 'OPEN',
      maxSlots,
      prizeAmountCents: 1000,
      selectionMode: 'CREATOR_DECIDES',
    },
  });
  return { challengeId: challenge.id, creatorId: creator.id };
}

describe('Outbox-Kopplung: Event und Zustand im selben Commit', () => {
  it('schreibt bei erfolgreicher Reservierung genau ein Outbox-Event', async () => {
    const { challengeId } = await seedOpenChallenge();
    const user = await prisma.user.create({ data: { isAdult: true } });

    await joinChallenge(
      { prisma, events: new InMemoryEventPublisher() },
      { challengeId, userId: user.id },
    );

    const events = await prisma.outboxEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe('challenge.slot_reserved');
    expect(events[0]?.aggregateType).toBe('slot');
    expect(events[0]?.status).toBe('PENDING');
    expect((events[0]?.payload as Record<string, unknown>).challengeId).toBe(challengeId);
  });

  it('hinterlässt bei fehlgeschlagener Reservierung KEIN Event (Rollback)', async () => {
    const { challengeId, creatorId } = await seedOpenChallenge();

    // Der Ersteller darf nicht beitreten — die Transaktion bricht ab.
    await expect(
      joinChallenge(
        { prisma, events: new InMemoryEventPublisher() },
        { challengeId, userId: creatorId },
      ),
    ).rejects.toBeInstanceOf(AppError);

    expect(await prisma.outboxEvent.count()).toBe(0);
    expect(await prisma.slot.count()).toBe(0);
  });

  it('hinterlässt bei voller Challenge weder Slot noch Event', async () => {
    const { challengeId } = await seedOpenChallenge(1);
    const a = await prisma.user.create({ data: { isAdult: true } });
    const b = await prisma.user.create({ data: { isAdult: true } });

    await joinChallenge({ prisma, events: new InMemoryEventPublisher() }, { challengeId, userId: a.id });
    expect(await prisma.outboxEvent.count()).toBe(1);

    await expect(
      joinChallenge({ prisma, events: new InMemoryEventPublisher() }, { challengeId, userId: b.id }),
    ).rejects.toBeInstanceOf(AppError);

    // Der gescheiterte zweite Versuch darf nichts hinzugefügt haben.
    expect(await prisma.outboxEvent.count()).toBe(1);
    expect(await prisma.slot.count()).toBe(1);
  });

  it('erzeugt bei 50 parallelen Joins genau 10 Slots UND genau 10 Events', async () => {
    // Die Kombination ist der Punkt: Die Zehn-Plätze-Grenze und die Event-Anzahl
    // dürfen unter Last nicht auseinanderlaufen.
    const { challengeId } = await seedOpenChallenge(10);
    const users = await Promise.all(
      Array.from({ length: 50 }, () =>
        prisma.user.create({ data: { isAdult: true } }),
      ),
    );

    const results = await Promise.allSettled(
      users.map((u) =>
        joinChallenge(
          { prisma, events: new InMemoryEventPublisher() },
          { challengeId, userId: u.id },
        ),
      ),
    );

    const ok = results.filter((r) => r.status === 'fulfilled').length;
    expect(ok).toBe(10);
    expect(await prisma.slot.count({ where: { status: 'RESERVED' } })).toBe(10);

    const events = await prisma.outboxEvent.findMany();
    expect(events).toHaveLength(10);
    // Jedes Event gehört zu genau einem Slot — keine Duplikate.
    expect(new Set(events.map((e) => e.aggregateId)).size).toBe(10);

    const challenge = await prisma.challenge.findUnique({ where: { id: challengeId } });
    expect(challenge?.status).toBe('FULL');
  });

  it('vergibt monoton steigende Sequenzen für die Reihenfolge', async () => {
    const { challengeId } = await seedOpenChallenge();
    const users = await Promise.all(
      Array.from({ length: 3 }, () => prisma.user.create({ data: { isAdult: true } })),
    );
    for (const u of users) {
      await joinChallenge(
        { prisma, events: new InMemoryEventPublisher() },
        { challengeId, userId: u.id },
      );
    }
    const events = await prisma.outboxEvent.findMany({ orderBy: { sequence: 'asc' } });
    const seqs = events.map((e) => e.sequence);
    expect(seqs).toHaveLength(3);
    for (let i = 1; i < seqs.length; i += 1) {
      expect(seqs[i]! > seqs[i - 1]!).toBe(true);
    }
  });
});
