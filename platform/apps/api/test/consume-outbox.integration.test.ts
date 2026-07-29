import { PrismaClient } from '@prisma/client';
import { InMemoryBrokerPublisher, OutboxPublisher, createPrismaOutboxStore } from '@vcp/outbox';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { joinChallenge } from '../src/challenges/join-challenge.js';
import { InMemoryEventPublisher } from '../src/events/event-publisher.js';
import { consumeFromOutbox, PROJECTION_NAME } from '../src/projections/consume-outbox.js';
import { resetDb } from './reset-db.js';

/**
 * Consumer-Seite der Event-Kette.
 *
 * Der wichtigste Test hier ist die **vollständige Kette**: Domänen-Transaktion →
 * Outbox → Publisher → Consumer → Read Model. Jedes Glied einzeln zu prüfen genügt
 * nicht, weil Fehler typischerweise an den Übergängen entstehen.
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

async function seedAndJoin(count: number): Promise<string> {
  const creator = await prisma.user.create({ data: { isAdult: true } });
  const challenge = await prisma.challenge.create({
    data: {
      creatorId: creator.id,
      title: 'Kette',
      status: 'OPEN',
      maxSlots: 10,
      prizeAmountCents: 4200,
      selectionMode: 'CREATOR_DECIDES',
    },
  });
  for (let i = 0; i < count; i += 1) {
    const u = await prisma.user.create({ data: { isAdult: true } });
    await joinChallenge(
      { prisma, events: new InMemoryEventPublisher() },
      { challengeId: challenge.id, userId: u.id },
    );
  }
  return challenge.id;
}

/** Stellt alle ausstehenden Outbox-Einträge zu (macht sie für den Consumer sichtbar). */
async function publishAll(): Promise<number> {
  const broker = new InMemoryBrokerPublisher();
  const r = await new OutboxPublisher(createPrismaOutboxStore(prisma), broker).drain();
  return r.published;
}

describe('Vollständige Event-Kette', () => {
  it('führt von der Domänen-Transaktion bis ins Read Model', async () => {
    const challengeId = await seedAndJoin(3);

    // 1. Domäne: Events liegen in der Outbox, Read Model ist noch leer.
    expect(await prisma.outboxEvent.count()).toBe(3);
    expect(await prisma.challengePublicProjection.count()).toBe(0);

    // 2. Publisher.
    expect(await publishAll()).toBe(3);

    // 3. Consumer.
    const stats = await consumeFromOutbox(prisma);
    expect(stats.processed).toBe(3);
    expect(stats.applied).toBe(3);

    // 4. Read Model trägt den korrekten Zustand.
    const p = await prisma.challengePublicProjection.findUnique({ where: { challengeId } });
    expect(p?.status).toBe('OPEN');
    expect(p?.prizeAmountCents).toBe(4200);
    expect(p?.occupiedSlots).toBe(3);
    expect(p?.maxSlots).toBe(10);
  });

  it('verarbeitet noch nicht veröffentlichte Einträge nicht', async () => {
    await seedAndJoin(2);
    // Kein Publisher-Lauf: Die Einträge stehen auf PENDING.
    const stats = await consumeFromOutbox(prisma);
    expect(stats.processed).toBe(0);
    expect(await prisma.challengePublicProjection.count()).toBe(0);
  });

  it('ist bei einem zweiten Lauf folgenlos', async () => {
    await seedAndJoin(3);
    await publishAll();
    await consumeFromOutbox(prisma);

    const zweiter = await consumeFromOutbox(prisma);
    expect(zweiter.processed).toBe(0);
  });

  it('setzt nach einem zurückgesetzten Checkpoint erneut an, ohne doppelten Effekt', async () => {
    const challengeId = await seedAndJoin(3);
    await publishAll();
    await consumeFromOutbox(prisma);

    // Checkpoint zurückdrehen — simuliert einen Wiederaufbau.
    await prisma.projectionCheckpoint.update({
      where: { projectionName: PROJECTION_NAME },
      data: { lastSequence: 0n },
    });

    const erneut = await consumeFromOutbox(prisma);
    expect(erneut.processed).toBe(3);
    // Die Inbox erkennt sie als bereits verarbeitet — kein zweiter Effekt.
    expect(erneut.applied).toBe(0);
    expect(erneut.duplicates).toBe(3);

    const p = await prisma.challengePublicProjection.findUnique({ where: { challengeId } });
    expect(p?.occupiedSlots).toBe(3);
  });

  it('schreibt den Checkpoint erst nach dem Batch', async () => {
    await seedAndJoin(3);
    await publishAll();
    await consumeFromOutbox(prisma);

    const cp = await prisma.projectionCheckpoint.findUnique({
      where: { projectionName: PROJECTION_NAME },
    });
    // Der Checkpoint steht auf der zuletzt verarbeiteten Sequenz, nicht davor.
    expect(cp?.lastSequence).toBe(3n);
  });

  it('arbeitet einen Rückstand über mehrere Batches ab', async () => {
    await seedAndJoin(5);
    await publishAll();

    const erster = await consumeFromOutbox(prisma, 2);
    expect(erster.processed).toBe(2);
    const zweiter = await consumeFromOutbox(prisma, 2);
    expect(zweiter.processed).toBe(2);
    const dritter = await consumeFromOutbox(prisma, 2);
    expect(dritter.processed).toBe(1);
    expect((await consumeFromOutbox(prisma, 2)).processed).toBe(0);
  });

  it('hält die Anzeige-Slotzahl mit der Primärtabelle konsistent', async () => {
    const challengeId = await seedAndJoin(4);
    await publishAll();
    await consumeFromOutbox(prisma);

    const real = await prisma.slot.count({
      where: { challengeId, status: { in: ['RESERVED', 'CAPTURING', 'UPLOADING', 'SUBMITTED'] } },
    });
    const p = await prisma.challengePublicProjection.findUnique({ where: { challengeId } });
    expect(p?.occupiedSlots).toBe(real);
  });
});
