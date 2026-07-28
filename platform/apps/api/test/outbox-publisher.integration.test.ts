import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  InMemoryBrokerPublisher,
  OutboxPublisher,
  createPrismaOutboxStore,
  toBrokerMessage,
  type EventPublisher,
} from '@vcp/outbox';
import { joinChallenge } from '../src/challenges/join-challenge.js';
import { InMemoryEventPublisher } from '../src/events/event-publisher.js';
import { resetDb } from './reset-db.js';

/**
 * End-to-End-Kette: Domänen-Transaktion → Outbox-Zeile → Publisher → Broker.
 *
 * Der Unit-Test beweist die Publisher-Logik gegen Test-Doubles; hier läuft dieselbe
 * Kette gegen echte PostgreSQL-Zeilen, die von echtem Domänencode geschrieben wurden.
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

async function seedJoin(): Promise<string> {
  const creator = await prisma.user.create({ data: { isAdult: true } });
  const challenge = await prisma.challenge.create({
    data: {
      creatorId: creator.id,
      title: 'Publisher-Test',
      status: 'OPEN',
      maxSlots: 10,
      prizeAmountCents: 1000,
      selectionMode: 'CREATOR_DECIDES',
    },
  });
  const user = await prisma.user.create({ data: { isAdult: true } });
  await joinChallenge(
    { prisma, events: new InMemoryEventPublisher() },
    { challengeId: challenge.id, userId: user.id },
  );
  return challenge.id;
}

describe('Outbox-Publisher gegen echte Domänen-Events', () => {
  it('stellt ein real geschriebenes Event zu und markiert es als PUBLISHED', async () => {
    const challengeId = await seedJoin();

    const broker = new InMemoryBrokerPublisher();
    const result = await new OutboxPublisher(createPrismaOutboxStore(prisma), broker).runOnce();

    expect(result.published).toBe(1);
    expect(broker.published).toHaveLength(1);
    expect(broker.published[0]?.eventType).toBe('challenge.slot_reserved');
    expect((broker.published[0]?.payload as Record<string, unknown>).challengeId).toBe(challengeId);

    const row = await prisma.outboxEvent.findFirst();
    expect(row?.status).toBe('PUBLISHED');
    expect(row?.publishedAt).not.toBeNull();
  });

  it('stellt ein bereits veröffentlichtes Event nicht erneut zu', async () => {
    await seedJoin();
    const store = createPrismaOutboxStore(prisma);
    const broker = new InMemoryBrokerPublisher();

    await new OutboxPublisher(store, broker).drain();
    await new OutboxPublisher(store, broker).drain();

    expect(broker.published).toHaveLength(1);
  });

  it('hält ein fehlgeschlagenes Event für einen späteren Versuch bereit', async () => {
    await seedJoin();
    const store = createPrismaOutboxStore(prisma);
    const failing: EventPublisher = {
      async publish() {
        throw new Error('Broker nicht erreichbar');
      },
    };

    await new OutboxPublisher(store, failing, { backoffBaseMs: 1, maxAttempts: 5 }).runOnce();
    const row = await prisma.outboxEvent.findFirst();
    expect(row?.status).toBe('PENDING');
    expect(row?.attempts).toBe(1);
    expect(row?.lastError).toContain('Broker nicht erreichbar');

    // Der nächste Versuch mit funktionierendem Broker stellt zu — nichts geht verloren.
    const broker = new InMemoryBrokerPublisher();
    await new OutboxPublisher(store, broker, {
      now: () => new Date(Date.now() + 60_000),
    }).runOnce();
    expect(broker.published).toHaveLength(1);
    expect((await prisma.outboxEvent.findFirst())?.status).toBe('PUBLISHED');
  });

  it('serialisiert die Broker-Nachricht mit Dedup- und Ordering-Key', async () => {
    await seedJoin();
    const claimed = await createPrismaOutboxStore(prisma).claimBatch(1, new Date());
    const event = claimed[0]!;
    const msg = toBrokerMessage(event);

    // eventId ist der Deduplizierungsschlüssel der Consumer-Inbox.
    expect(msg.attributes.eventId).toBe(event.eventId);
    // Reihenfolge garantiert Pub/Sub nur je Ordering Key — fachlich je Aggregat.
    expect(msg.orderingKey).toBe(`${event.aggregateType}:${event.aggregateId}`);

    const decoded = JSON.parse(msg.data.toString('utf8')) as Record<string, unknown>;
    expect(decoded.eventType).toBe('challenge.slot_reserved');
    expect(decoded.sequence).toBe(event.sequence.toString());
  });

  it('arbeitet einen Rückstand vieler Events vollständig ab', async () => {
    const creator = await prisma.user.create({ data: { isAdult: true } });
    const challenge = await prisma.challenge.create({
      data: {
        creatorId: creator.id,
        title: 'Rückstand',
        status: 'OPEN',
        maxSlots: 10,
        prizeAmountCents: 1000,
        selectionMode: 'CREATOR_DECIDES',
      },
    });
    const users = await Promise.all(
      Array.from({ length: 10 }, () => prisma.user.create({ data: { isAdult: true } })),
    );
    for (const u of users) {
      await joinChallenge(
        { prisma, events: new InMemoryEventPublisher() },
        { challengeId: challenge.id, userId: u.id },
      );
    }
    expect(await prisma.outboxEvent.count()).toBe(10);

    const broker = new InMemoryBrokerPublisher();
    // Kleine Batches erzwingen mehrere Durchläufe.
    const result = await new OutboxPublisher(createPrismaOutboxStore(prisma), broker, {
      batchSize: 3,
    }).drain();

    expect(result.published).toBe(10);
    expect(broker.published).toHaveLength(10);
    expect(await prisma.outboxEvent.count({ where: { status: 'PENDING' } })).toBe(0);
  });
});
