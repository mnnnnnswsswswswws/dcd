import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CacheStore } from '@vcp/cache';
import { AppError } from '@vcp/contracts';
import { joinChallenge } from '../src/challenges/join-challenge.js';
import { ChallengeDetailCache } from '../src/challenges/challenge-detail-cache.js';
import { InMemoryEventPublisher } from '../src/events/event-publisher.js';
import {
  ProjectionOutcome,
  applyChallengeProjection,
  rebuildChallengeProjection,
} from '../src/projections/challenge-projection.js';
import { resetDb } from './reset-db.js';

const prisma = new PrismaClient();

class MemoryStore implements CacheStore {
  map = new Map<string, string>();
  down = false;
  async get(k: string) {
    if (this.down) throw new Error('redis down');
    return this.map.get(k) ?? null;
  }
  async set(k: string, v: string) {
    if (this.down) throw new Error('redis down');
    this.map.set(k, v);
  }
  async del(k: string) {
    this.map.delete(k);
  }
}

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDb(prisma);
});

async function seed(maxSlots = 10) {
  const creator = await prisma.user.create({ data: { isAdult: true } });
  const challenge = await prisma.challenge.create({
    data: {
      creatorId: creator.id,
      title: 'Projektionstest',
      status: 'OPEN',
      maxSlots,
      prizeAmountCents: 2500,
      selectionMode: 'CREATOR_DECIDES',
    },
  });
  return { challengeId: challenge.id, creatorId: creator.id };
}

const msg = (challengeId: string, sequence: bigint, over: Record<string, unknown> = {}) => ({
  messageId: `m-${sequence}-${Math.random()}`,
  eventType: 'challenge.slot_reserved',
  aggregateType: 'slot',
  aggregateId: 'slot-1',
  sequence,
  payload: { challengeId, ...over },
});

describe('Challenge Public Projection', () => {
  it('legt die Projektion aus einem Event an', async () => {
    const { challengeId } = await seed();
    const r = await applyChallengeProjection(prisma, msg(challengeId, 1n));
    expect(r.outcome).toBe(ProjectionOutcome.APPLIED);

    const p = await prisma.challengePublicProjection.findUnique({ where: { challengeId } });
    expect(p?.status).toBe('OPEN');
    expect(p?.prizeAmountCents).toBe(2500);
    expect(p?.lastSequence).toBe(1n);
  });

  it('ist idempotent bei doppelter Zustellung', async () => {
    const { challengeId } = await seed();
    const m = msg(challengeId, 1n);
    expect((await applyChallengeProjection(prisma, m)).outcome).toBe(ProjectionOutcome.APPLIED);
    expect((await applyChallengeProjection(prisma, m)).outcome).toBe(ProjectionOutcome.DUPLICATE);
    expect(await prisma.challengePublicProjection.count()).toBe(1);
  });

  it('verwirft eine verspätete ältere Nachricht', async () => {
    const { challengeId } = await seed();
    await applyChallengeProjection(prisma, msg(challengeId, 10n));
    const stale = await applyChallengeProjection(prisma, msg(challengeId, 5n));
    expect(stale.outcome).toBe(ProjectionOutcome.STALE);
    const p = await prisma.challengePublicProjection.findUnique({ where: { challengeId } });
    expect(p?.lastSequence).toBe(10n);
  });

  it('ignoriert fachlich irrelevante Events', async () => {
    const { challengeId } = await seed();
    const r = await applyChallengeProjection(prisma, {
      ...msg(challengeId, 1n),
      eventType: 'comment.created',
    });
    expect(r.outcome).toBe(ProjectionOutcome.IGNORED);
    expect(await prisma.challengePublicProjection.count()).toBe(0);
  });

  it('spiegelt die tatsächliche Slotzahl aus der Primärtabelle', async () => {
    const { challengeId } = await seed();
    const users = await Promise.all(
      Array.from({ length: 3 }, () => prisma.user.create({ data: { isAdult: true } })),
    );
    for (const u of users) {
      await joinChallenge(
        { prisma, events: new InMemoryEventPublisher() },
        { challengeId, userId: u.id },
      );
    }
    await applyChallengeProjection(prisma, msg(challengeId, 100n));
    const p = await prisma.challengePublicProjection.findUnique({ where: { challengeId } });
    expect(p?.occupiedSlots).toBe(3);
  });

  it('baut die Projektion aus der Outbox nach und merkt sich den Fortschritt', async () => {
    const { challengeId } = await seed();
    const u = await prisma.user.create({ data: { isAdult: true } });
    await joinChallenge({ prisma, events: new InMemoryEventPublisher() }, { challengeId, userId: u.id });

    const r = await rebuildChallengeProjection(prisma);
    expect(r.applied).toBeGreaterThan(0);
    expect(await prisma.challengePublicProjection.count()).toBe(1);

    const cp = await prisma.projectionCheckpoint.findFirst();
    expect(cp?.lastSequence).toBeGreaterThan(0n);

    // Erneuter Rebuild ist folgenlos — kein Doppeleffekt.
    const again = await rebuildChallengeProjection(prisma);
    expect(again.processed).toBe(0);
  });
});

describe('Challenge Detail Cache', () => {
  it('liefert die öffentliche Ansicht und danach aus dem Cache', async () => {
    const { challengeId } = await seed();
    const store = new MemoryStore();
    const cache = new ChallengeDetailCache({ prisma, store });

    const first = await cache.get(challengeId);
    expect(first?.prizeAmountCents).toBe(2500);
    expect(store.map.size).toBe(1);

    // Zweiter Aufruf mit "abgeschalteter" DB-Sicht: kommt aus dem Cache.
    const second = await cache.get(challengeId);
    expect(second?.challengeId).toBe(challengeId);
  });

  it('nutzt die Projektion, sobald sie existiert', async () => {
    const { challengeId } = await seed();
    await applyChallengeProjection(prisma, msg(challengeId, 1n));
    // Projektion künstlich abweichen lassen, um die Quelle zu beweisen.
    await prisma.challengePublicProjection.update({
      where: { challengeId },
      data: { title: 'AUS-PROJEKTION' },
    });

    const view = await new ChallengeDetailCache({ prisma, store: new MemoryStore() }).get(challengeId);
    expect(view?.title).toBe('AUS-PROJEKTION');
  });

  it('fällt auf die Primärtabelle zurück, solange die Projektion fehlt', async () => {
    const { challengeId } = await seed();
    expect(await prisma.challengePublicProjection.count()).toBe(0);
    const view = await new ChallengeDetailCache({ prisma, store: new MemoryStore() }).get(challengeId);
    // Ein Projektionsrückstand darf nie als "existiert nicht" erscheinen.
    expect(view).not.toBeNull();
    expect(view?.title).toBe('Projektionstest');
  });

  it('liefert weiter, wenn Redis ausfällt', async () => {
    const { challengeId } = await seed();
    const store = new MemoryStore();
    store.down = true;
    const view = await new ChallengeDetailCache({ prisma, store }).get(challengeId);
    expect(view?.challengeId).toBe(challengeId);
  });

  it('invalidiert flächig über einen Namespace-Versions-Bump', async () => {
    const { challengeId } = await seed();
    const store = new MemoryStore();

    await new ChallengeDetailCache({ prisma, store, namespaceVersion: 1 }).get(challengeId);
    await prisma.challenge.update({ where: { id: challengeId }, data: { title: 'NEU' } });

    // Alte Version liefert weiter den alten Wert …
    const alt = await new ChallengeDetailCache({ prisma, store, namespaceVersion: 1 }).get(challengeId);
    expect(alt?.title).toBe('Projektionstest');
    // … die neue Version sieht den Schlüssel nicht mehr und lädt frisch.
    const neu = await new ChallengeDetailCache({ prisma, store, namespaceVersion: 2 }).get(challengeId);
    expect(neu?.title).toBe('NEU');
  });
});

describe('Regel 9: Anzeige-Slotzahl beeinflusst die Platzvergabe nicht', () => {
  it('lehnt den elften Join ab, auch wenn Projektion und Cache Platz behaupten', async () => {
    const { challengeId } = await seed(1);
    const a = await prisma.user.create({ data: { isAdult: true } });
    const b = await prisma.user.create({ data: { isAdult: true } });

    await joinChallenge({ prisma, events: new InMemoryEventPublisher() }, { challengeId, userId: a.id });

    // Projektion bewusst verfälschen: Sie behauptet, es sei noch frei.
    await applyChallengeProjection(prisma, msg(challengeId, 1n));
    await prisma.challengePublicProjection.update({
      where: { challengeId },
      data: { occupiedSlots: 0, status: 'OPEN' },
    });
    const store = new MemoryStore();
    const view = await new ChallengeDetailCache({ prisma, store }).get(challengeId);
    expect(view?.occupiedSlotsForDisplay).toBe(0); // die Anzeige lügt jetzt

    // join zählt trotzdem gegen die Primärtabelle unter Row-Lock.
    await expect(
      joinChallenge({ prisma, events: new InMemoryEventPublisher() }, { challengeId, userId: b.id }),
    ).rejects.toBeInstanceOf(AppError);

    expect(await prisma.slot.count({ where: { status: 'RESERVED' } })).toBe(1);
  });

  it('hält die Zehn-Plätze-Grenze auch bei komplett veralteter Projektion', async () => {
    const { challengeId } = await seed(10);
    // Projektion behauptet: leer.
    await applyChallengeProjection(prisma, msg(challengeId, 1n));

    const users = await Promise.all(
      Array.from({ length: 20 }, () => prisma.user.create({ data: { isAdult: true } })),
    );
    const results = await Promise.allSettled(
      users.map((u) =>
        joinChallenge({ prisma, events: new InMemoryEventPublisher() }, { challengeId, userId: u.id }),
      ),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(10);
    expect(await prisma.slot.count({ where: { status: 'RESERVED' } })).toBe(10);
  });
});

describe('Out-of-order-Schutz unter parallelen Consumern', () => {
  it('lässt last_sequence nie hinter die höchste angewandte Sequenz zurückfallen', async () => {
    // Gefunden beim Lauf gegen echtes Pub/Sub: Ein Abonnement stellt gleichzeitig
    // zu, und Terraform stellt vier Projektions-Instanzen bereit. Ein
    // Lesen-Vergleichen-Schreiben lässt dann zwei Transaktionen denselben Stand
    // lesen — beide halten ihre Nachricht für die neuere, die zuletzt schreibende
    // gewinnt, und der Zähler bleibt zurück.
    const { challengeId } = await seed();

    const nachrichten = [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n].map((sequence) => ({
      messageId: `parallel-${sequence}`,
      eventType: 'challenge.slot_reserved',
      aggregateType: 'slot',
      aggregateId: 'slot-1',
      sequence,
      payload: { challengeId },
    }));

    const ergebnisse = await Promise.all(
      nachrichten.map((m) => applyChallengeProjection(prisma, m)),
    );

    const angewandt = ergebnisse
      .map((r, i) => (r.outcome === ProjectionOutcome.APPLIED ? nachrichten[i]!.sequence : 0n))
      .filter((s) => s > 0n);
    const hoechsteAngewandt = angewandt.reduce((a, b) => (a > b ? a : b), 0n);

    const p = await prisma.challengePublicProjection.findUnique({ where: { challengeId } });
    expect(p?.lastSequence).toBe(hoechsteAngewandt);
  });

  it('verwirft eine verspätete ältere Nachricht auch im Wettlauf', async () => {
    const { challengeId } = await seed();
    await applyChallengeProjection(prisma, {
      messageId: 'spaet-neu',
      eventType: 'challenge.slot_reserved',
      aggregateType: 'slot',
      aggregateId: 'slot-1',
      sequence: 100n,
      payload: { challengeId },
    });

    const alt = await applyChallengeProjection(prisma, {
      messageId: 'spaet-alt',
      eventType: 'challenge.slot_reserved',
      aggregateType: 'slot',
      aggregateId: 'slot-1',
      sequence: 99n,
      payload: { challengeId },
    });

    expect(alt.outcome).toBe(ProjectionOutcome.STALE);
    const p = await prisma.challengePublicProjection.findUnique({ where: { challengeId } });
    expect(p?.lastSequence).toBe(100n);
  });
});
