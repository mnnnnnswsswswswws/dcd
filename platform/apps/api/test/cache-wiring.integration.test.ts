import { PrismaClient } from '@prisma/client';
import { InMemoryBrokerPublisher, OutboxPublisher, createPrismaOutboxStore } from '@vcp/outbox';
import { createMemoryCacheStore } from '@vcp/cache';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChallengeDetailCache } from '../src/challenges/challenge-detail-cache.js';
import { createCacheStore } from '../src/cache/cache.module.js';
import { joinChallenge } from '../src/challenges/join-challenge.js';
import { InMemoryEventPublisher } from '../src/events/event-publisher.js';
import { consumeFromOutbox } from '../src/projections/consume-outbox.js';
import { resetDb } from './reset-db.js';

/**
 * Beweist, dass der Cache im **laufenden** Dienst erreichbar ist.
 *
 * Der Grund für diesen Test: `@vcp/cache` war vollständig gebaut und getestet, aber
 * kein Codepfad der API hat je einen Store erzeugt. Unit-Tests des Pakets hätten das
 * nie aufgedeckt — sie bauen ihren Store selbst. Geprüft wird deshalb die Verdrahtung
 * (createCacheStore) und das Verhalten am tatsächlichen Lesepfad.
 */
const prisma = new PrismaClient();
const stillerLogger = { log: vi.fn(), warn: vi.fn() };

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDb(prisma);
  stillerLogger.log.mockClear();
  stillerLogger.warn.mockClear();
});

describe('Store-Auswahl', () => {
  it('nimmt ohne REDIS_URL den prozesslokalen Store und sagt es', async () => {
    const store = await createCacheStore(stillerLogger, {});
    await store.set('k', 'v', 1_000);
    expect(await store.get('k')).toBe('v');
    // Der Hinweis ist wichtig: In Produktion ist das die falsche Wahl.
    expect(stillerLogger.warn).toHaveBeenCalledWith(expect.stringContaining('REDIS_URL'));
  });

  it('fällt bei unbrauchbarer REDIS_URL zurück, statt den Start zu verhindern', async () => {
    // Ein Cache ist nie autoritativ — sein Ausfall macht den Dienst langsamer,
    // nicht falsch. Ein Startabbruch wäre die härtere und falsche Reaktion.
    const store = await createCacheStore(stillerLogger, { REDIS_URL: 'kein-gueltiges-schema://x' });
    await store.set('k', 'v', 1_000);
    expect(await store.get('k')).toBe('v');
  });

  it('nimmt mit REDIS_URL den Redis-Store', async () => {
    if (process.env.REDIS_URL === undefined) return;
    const store = await createCacheStore(stillerLogger, { REDIS_URL: process.env.REDIS_URL });
    await store.set('verdrahtung', 'echt', 5_000);
    expect(await store.get('verdrahtung')).toBe('echt');
    expect(stillerLogger.log).toHaveBeenCalledWith(expect.stringContaining('Redis'));
  });
});

/** Legt eine Challenge an, besetzt `count` Plätze und zieht die Projektion nach. */
async function seedProjiziert(count: number): Promise<string> {
  const creator = await prisma.user.create({ data: { isAdult: true } });
  const challenge = await prisma.challenge.create({
    data: {
      creatorId: creator.id,
      title: 'Cache',
      status: 'OPEN',
      maxSlots: 10,
      prizeAmountCents: 4200,
      selectionMode: 'CREATOR_DECIDES',
    },
  });
  for (let i = 0; i < count; i += 1) {
    const u = await prisma.user.create({ data: { isAdult: true } });
    await joinChallenge({ prisma, events: new InMemoryEventPublisher() }, { challengeId: challenge.id, userId: u.id });
  }
  await new OutboxPublisher(createPrismaOutboxStore(prisma), new InMemoryBrokerPublisher()).drain();
  await consumeFromOutbox(prisma);
  return challenge.id;
}

describe('Lesepfad über den Cache', () => {
  it('liefert den Platzstand und lädt beim zweiten Abruf nicht erneut', async () => {
    const challengeId = await seedProjiziert(3);
    const store = createMemoryCacheStore();
    const cache = new ChallengeDetailCache({ prisma, store });

    const erst = await cache.get(challengeId);
    expect(erst?.occupiedSlotsForDisplay).toBe(3);
    expect(erst?.prizeAmountCents).toBe(4200);

    // Datenbank für den zweiten Abruf unbrauchbar machen: Was jetzt noch
    // herauskommt, kam aus dem Cache — und nicht aus einer stillen Zweitabfrage.
    const gesperrt = new ChallengeDetailCache({
      prisma: {
        challengePublicProjection: {
          findUnique: async () => {
            throw new Error('Es darf kein zweiter Ladevorgang stattfinden.');
          },
        },
      } as unknown as PrismaClient,
      store,
    });
    expect((await gesperrt.get(challengeId))?.occupiedSlotsForDisplay).toBe(3);
  });

  it('meldet eine unbekannte Challenge als null', async () => {
    const cache = new ChallengeDetailCache({ prisma, store: createMemoryCacheStore() });
    expect(await cache.get('00000000-0000-4000-8000-000000000000')).toBeNull();
  });

  it('hält einen veralteten Platzstand von der Platzvergabe fern', async () => {
    // Der Kern von Architekturregel 9: Der Cache ist Anzeige, nie Autorität.
    const challengeId = await seedProjiziert(10);
    const cache = new ChallengeDetailCache({ prisma, store: createMemoryCacheStore() });
    await cache.get(challengeId);

    // Projektion fälschen: Der Cache-Pfad meldet jetzt "leer und offen".
    await prisma.challengePublicProjection.update({
      where: { challengeId },
      data: { occupiedSlots: 0, status: 'OPEN' },
    });
    const frisch = new ChallengeDetailCache({ prisma, store: createMemoryCacheStore() });
    expect((await frisch.get(challengeId))?.occupiedSlotsForDisplay).toBe(0);

    // joinChallenge liest trotzdem die Primärtabelle und lehnt ab.
    const u = await prisma.user.create({ data: { isAdult: true } });
    await expect(
      joinChallenge({ prisma, events: new InMemoryEventPublisher() }, { challengeId, userId: u.id }),
    ).rejects.toThrow();
  });
});
