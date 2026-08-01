import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CacheStore } from '@vcp/cache';
import { ChallengeDetailCache } from '../src/challenges/challenge-detail-cache.js';
import { processPayout } from '../src/funding/process-payout.js';
import { selectWinner } from '../src/challenges/select-winner.js';
import { joinChallenge } from '../src/challenges/join-challenge.js';
import { submitEntry } from '../src/submissions/submit-entry.js';
import { moderateSubmission } from '../src/submissions/moderate-submission.js';
import { InMemoryEventPublisher } from '../src/events/event-publisher.js';
import { resetDb } from './reset-db.js';

/**
 * Pflichtlasttests (Scale S1, Aufgabe 14) — die beiden Szenarien, die bisher
 * fehlten: virale Leselast und ein doppelt zugestellter Payment-Task.
 *
 * Beide prüfen dieselbe Grundfrage aus verschiedenen Richtungen: Was passiert,
 * wenn ein Vorgang öfter läuft, als er soll? Bei Reads darf das nur Kosten
 * verursachen, bei Geld darf es gar nichts verursachen.
 */
const prisma = new PrismaClient();

/** Zählt echte Ladevorgänge, damit die Cache-Wirkung messbar ist. */
class CountingStore implements CacheStore {
  map = new Map<string, string>();
  gets = 0;
  async get(k: string) {
    this.gets += 1;
    return this.map.get(k) ?? null;
  }
  async set(k: string, v: string) {
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

describe('Virale Leselast', () => {
  it('bedient 500 gleichzeitige Detailabrufe mit genau einem Datenbankladevorgang', async () => {
    const creator = await prisma.user.create({ data: { isAdult: true } });
    const challenge = await prisma.challenge.create({
      data: {
        creatorId: creator.id,
        title: 'Viral',
        status: 'OPEN',
        maxSlots: 10,
        prizeAmountCents: 5000,
        selectionMode: 'COMMUNITY_VOTE',
      },
    });

    const store = new CountingStore();
    const cache = new ChallengeDetailCache({ prisma, store });

    let dbLoads = 0;
    const originalFindUnique = prisma.challenge.findUnique.bind(prisma.challenge);
    // Zählt die tatsächlichen Primärzugriffe während des Ansturms.
    (prisma.challenge as unknown as { findUnique: typeof originalFindUnique }).findUnique = (
      ...args: Parameters<typeof originalFindUnique>
    ) => {
      dbLoads += 1;
      return originalFindUnique(...args);
    };

    try {
      const results = await Promise.all(
        Array.from({ length: 500 }, () => cache.get(challenge.id)),
      );
      expect(results).toHaveLength(500);
      expect(results.every((r) => r?.challengeId === challenge.id)).toBe(true);
      // Singleflight: 500 gleichzeitige Misses lösen genau einen Ladevorgang aus.
      expect(dbLoads).toBe(1);
    } finally {
      (prisma.challenge as unknown as { findUnique: typeof originalFindUnique }).findUnique =
        originalFindUnique;
    }
  });

  it('liefert unter Last denselben Inhalt an alle Aufrufer', async () => {
    const creator = await prisma.user.create({ data: { isAdult: true } });
    const challenge = await prisma.challenge.create({
      data: {
        creatorId: creator.id,
        title: 'Gleichheit',
        status: 'OPEN',
        maxSlots: 10,
        prizeAmountCents: 1234,
        selectionMode: 'CREATOR_DECIDES',
      },
    });
    const cache = new ChallengeDetailCache({ prisma, store: new CountingStore() });
    const views = await Promise.all(Array.from({ length: 200 }, () => cache.get(challenge.id)));
    const serialized = new Set(views.map((v) => JSON.stringify(v)));
    // Kein Aufrufer sieht einen abweichenden Zwischenstand.
    expect(serialized.size).toBe(1);
  });
});

describe('Payment-Task doppelt zugestellt', () => {
  /** Baut eine Challenge bis zur gesperrten Gewinnerentscheidung auf. */
  async function seedUntilWinnerLocked(): Promise<string> {
    const creator = await prisma.user.create({ data: { isAdult: true } });
    const participant = await prisma.user.create({ data: { isAdult: true } });
    const challenge = await prisma.challenge.create({
      data: {
        creatorId: creator.id,
        title: 'Auszahlung',
        status: 'OPEN',
        maxSlots: 10,
        prizeAmountCents: 5000,
        selectionMode: 'CREATOR_DECIDES',
      },
    });
    const events = new InMemoryEventPublisher();

    await joinChallenge({ prisma, events }, { challengeId: challenge.id, userId: participant.id });
    const sub = await submitEntry(
      { prisma, events },
      { challengeId: challenge.id, userId: participant.id },
    );
    await moderateSubmission(
      { prisma, events },
      { submissionId: sub.submissionId, decision: 'APPROVED', isAdmin: true },
    );
    await prisma.challenge.update({
      where: { id: challenge.id },
      data: { status: 'SUBMISSIONS_CLOSED' },
    });
    await selectWinner(
      { prisma, events },
      {
        challengeId: challenge.id,
        actorId: creator.id,
        isAdmin: false,
        winnerSubmissionId: sub.submissionId,
      },
    );
    return challenge.id;
  }

  it('zahlt bei doppelter Zustellung nur einmal aus', async () => {
    const challengeId = await seedUntilWinnerLocked();
    const events = new InMemoryEventPublisher();

    const first = await processPayout({ prisma, events }, { challengeId, isAdmin: true, payoutsEnabled: true });
    // Der Task wird erneut zugestellt (Cloud Tasks garantiert at-least-once).
    const second = await processPayout({ prisma, events }, { challengeId, isAdmin: true, payoutsEnabled: true });

    expect(first.paid).toBe(true);
    expect(second.alreadyPaid).toBe(true);

    // Genau ein Payout-Datensatz, genau eine Buchung.
    expect(await prisma.payout.count({ where: { challengeId } })).toBe(1);
    const payoutEntries = await prisma.ledgerEntry.findMany({
      where: { challengeId, entryType: 'PAYOUT' },
    });
    // Doppelte Buchung heißt zwei Zeilen (Soll/Haben) — nicht vier.
    expect(payoutEntries).toHaveLength(2);
  });

  it('zahlt auch bei gleichzeitiger Doppelzustellung nur einmal aus', async () => {
    const challengeId = await seedUntilWinnerLocked();
    const events = new InMemoryEventPublisher();

    const results = await Promise.allSettled([
      processPayout({ prisma, events }, { challengeId, isAdmin: true, payoutsEnabled: true }),
      processPayout({ prisma, events }, { challengeId, isAdmin: true, payoutsEnabled: true }),
      processPayout({ prisma, events }, { challengeId, isAdmin: true, payoutsEnabled: true }),
    ]);

    const paid = results.filter(
      (r) => r.status === 'fulfilled' && r.value.paid === true,
    );
    // Höchstens einer darf tatsächlich ausgezahlt haben.
    expect(paid.length).toBeLessThanOrEqual(1);

    expect(await prisma.payout.count({ where: { challengeId } })).toBe(1);
    const entries = await prisma.ledgerEntry.findMany({
      where: { challengeId, entryType: 'PAYOUT' },
    });
    expect(entries).toHaveLength(2);

    // Die Bilanz muss aufgehen: Soll gleich Haben.
    const debit = entries
      .filter((e) => e.direction === 'DEBIT')
      .reduce((s, e) => s + e.amountCents, 0);
    const credit = entries
      .filter((e) => e.direction === 'CREDIT')
      .reduce((s, e) => s + e.amountCents, 0);
    expect(debit).toBe(credit);
  });

  it('hält die Gewinnerentscheidung bei doppeltem Aufruf unverändert', async () => {
    const challengeId = await seedUntilWinnerLocked();
    expect(await prisma.winnerDecision.count({ where: { challengeId } })).toBe(1);
  });
});
