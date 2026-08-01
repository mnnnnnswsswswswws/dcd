import { PrismaClient } from '@prisma/client';
import { InMemoryBrokerPublisher, OutboxPublisher, createPrismaOutboxStore } from '@vcp/outbox';
import { createMemoryCacheStore } from '@vcp/cache';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ChallengeListCache } from '../src/challenges/challenge-list-cache.js';
import { joinChallenge } from '../src/challenges/join-challenge.js';
import { InMemoryEventPublisher } from '../src/events/event-publisher.js';
import { consumeFromOutbox } from '../src/projections/consume-outbox.js';
import { resetDb } from './reset-db.js';

/**
 * Der heißeste Lesepfad.
 *
 * Warum es diesen Test gibt: Projektion und Cache existierten, hingen aber nur an
 * der Detail-Route. Die Liste — das, was ein Feed bei jedem Scroll aufruft — ging
 * bei jedem Request mit einem Aggregat über `slots` direkt an die Datenbank. Kein
 * Test hat das bemerkt, weil keiner gefragt hat, *welcher* Pfad den Cache benutzt.
 */
const prisma = new PrismaClient();
const events = new InMemoryEventPublisher();

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDb(prisma);
});

/**
 * Zählt echte Datenbankzugriffe über eine Prisma-Extension.
 *
 * Bewusst kein `vi.spyOn` auf den Delegates: Prisma stellt sie über Proxies
 * bereit, ein Spy darauf ersetzt die Methode und liefert `undefined` — der Test
 * würde dann nicht das Verhalten prüfen, sondern seinen eigenen Eingriff.
 */
function zaehlenderClient() {
  const zaehler = { challengeFindMany: 0, slotGroupBy: 0 };
  const client = prisma.$extends({
    query: {
      challenge: {
        findMany({ args, query }) {
          zaehler.challengeFindMany += 1;
          return query(args);
        },
      },
      slot: {
        groupBy({ args, query }) {
          zaehler.slotGroupBy += 1;
          return query(args);
        },
      },
    },
  }) as unknown as PrismaClient;
  return { client, zaehler };
}

async function seed(anzahlChallenges: number, teilnehmerJe = 0): Promise<string[]> {
  const creator = await prisma.user.create({ data: { isAdult: true } });
  const ids: string[] = [];
  for (let i = 0; i < anzahlChallenges; i += 1) {
    const c = await prisma.challenge.create({
      data: {
        creatorId: creator.id,
        title: `Challenge ${i}`,
        status: 'OPEN',
        maxSlots: 10,
        prizeAmountCents: 1000 + i,
        selectionMode: 'CREATOR_DECIDES',
      },
    });
    for (let j = 0; j < teilnehmerJe; j += 1) {
      const u = await prisma.user.create({ data: { isAdult: true } });
      await joinChallenge({ prisma, events }, { challengeId: c.id, userId: u.id });
    }
    ids.push(c.id);
  }
  return ids;
}

/** Zieht die Projektion nach, damit das Read Model gefüllt ist. */
async function projektionNachziehen(): Promise<void> {
  await new OutboxPublisher(createPrismaOutboxStore(prisma), new InMemoryBrokerPublisher()).drain();
  await consumeFromOutbox(prisma);
}

describe('Der Feed geht über den Cache', () => {
  it('liest beim zweiten Aufruf nicht erneut aus der Datenbank', async () => {
    await seed(3, 2);
    await projektionNachziehen();

    const { client, zaehler } = zaehlenderClient();
    const gezaehlt = new ChallengeListCache({ prisma: client, store: createMemoryCacheStore() });

    expect(await gezaehlt.list({ limit: 50 })).toHaveLength(3);
    expect(await gezaehlt.list({ limit: 50 })).toHaveLength(3);
    expect(await gezaehlt.list({ limit: 50 })).toHaveLength(3);

    // Drei Abrufe, ein Ladevorgang: Der zweite und dritte kamen aus dem Cache.
    expect(zaehler.challengeFindMany).toBe(1);
  });

  it('trennt unterschiedliche Filter in eigene Schlüssel', async () => {
    // Sonst bekäme ein Aufrufer die Antwort auf eine fremde Frage.
    const ids = await seed(2);
    await prisma.challenge.update({ where: { id: ids[0] as string }, data: { status: 'CANCELLED' } });
    const cache = new ChallengeListCache({ prisma, store: createMemoryCacheStore() });

    expect(await cache.list({ limit: 50 })).toHaveLength(2);
    expect(await cache.list({ status: 'OPEN', limit: 50 })).toHaveLength(1);
    expect(await cache.list({ limit: 1 })).toHaveLength(1);
  });
});

describe('Platzstand kommt aus dem Read Model', () => {
  it('bedient den Platzstand ohne Aggregat über die Platztabelle', async () => {
    // Der eigentliche Gewinn: Der COUNT über `slots` einer viralen Challenge ist
    // der Teil, der unter Last zuerst nachgibt.
    const ids = await seed(2, 3);
    await projektionNachziehen();

    const { client, zaehler } = zaehlenderClient();
    const cache = new ChallengeListCache({ prisma: client, store: createMemoryCacheStore() });
    const items = await cache.list({ limit: 50 });

    expect(items.every((i) => i.occupiedSlotsForDisplay === 3)).toBe(true);
    expect(zaehler.slotGroupBy, 'die Platztabelle darf hier nicht aggregiert werden').toBe(0);
    expect(ids).toHaveLength(2);
  });

  it('fällt auf die Primärtabelle zurück, solange die Projektion fehlt', async () => {
    // Eine gerade veröffentlichte Challenge darf nicht unsichtbar sein, nur weil
    // der Consumer noch nicht nachgezogen hat. Ein Rückstand im Read Model darf
    // sich nie als „existiert nicht" zeigen.
    await seed(1, 4);
    expect(await prisma.challengePublicProjection.count()).toBe(0);

    const cache = new ChallengeListCache({ prisma, store: createMemoryCacheStore() });
    const items = await cache.list({ limit: 50 });
    expect(items[0]?.occupiedSlotsForDisplay).toBe(4);
  });

  it('bleibt nur Anzeige — die Platzvergabe hört nicht auf den Cache', async () => {
    // Architekturregel 9. Der Test fälscht die Projektion und zeigt, dass
    // joinChallenge trotzdem gegen die Primärtabelle entscheidet.
    const [challengeId] = await seed(1, 10);
    await projektionNachziehen();
    await prisma.challengePublicProjection.update({
      where: { challengeId: challengeId as string },
      data: { occupiedSlots: 0, status: 'OPEN' },
    });

    const cache = new ChallengeListCache({ prisma, store: createMemoryCacheStore() });
    expect((await cache.list({ limit: 50 }))[0]?.occupiedSlotsForDisplay).toBe(0);

    const u = await prisma.user.create({ data: { isAdult: true } });
    await expect(
      joinChallenge({ prisma, events }, { challengeId: challengeId as string, userId: u.id }),
    ).rejects.toThrow();
  });
});

describe('Last auf der Datenbank', () => {
  it('bedient 200 gleichzeitige Feed-Abrufe mit einem Ladevorgang', async () => {
    // Genau der virale Fall: Alle schauen gleichzeitig denselben Feed an.
    await seed(5, 2);
    await projektionNachziehen();

    const { client, zaehler } = zaehlenderClient();
    const cache = new ChallengeListCache({ prisma: client, store: createMemoryCacheStore() });
    const ergebnisse = await Promise.all(
      Array.from({ length: 200 }, () => cache.list({ limit: 50 })),
    );

    expect(ergebnisse.every((r) => r.length === 5)).toBe(true);
    // Singleflight: 200 Abrufe, ein Ladevorgang.
    expect(zaehler.challengeFindMany).toBe(1);
  });

  it('liefert bei totem Cache weiterhin korrekte Daten', async () => {
    // Fail-open: Fällt Redis aus, wird der Pfad langsamer, nicht falsch.
    await seed(2, 1);
    const kaputt = {
      async get(): Promise<string | null> {
        throw new Error('ECONNREFUSED');
      },
      async set(): Promise<void> {
        throw new Error('ECONNREFUSED');
      },
      async del(): Promise<void> {
        throw new Error('ECONNREFUSED');
      },
    };
    const cache = new ChallengeListCache({ prisma, store: kaputt });
    expect(await cache.list({ limit: 50 })).toHaveLength(2);
  });
});
