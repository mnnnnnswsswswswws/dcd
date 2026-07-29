import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  STUCK_OPERATION_MS,
  collectBusinessIntegrity,
  collectDbMetrics,
  collectMetrics,
  collectOutboxMetrics,
  collectProjectionMetrics,
  collectQueueMetrics,
  collectReplicaMetrics,
} from '../src/observability/metrics.js';
import { joinChallenge } from '../src/challenges/join-challenge.js';
import { InMemoryEventPublisher } from '../src/events/event-publisher.js';
import { OperationKind, createOperation, markRunning } from '../src/operations/async-operations.js';
import { resetDb } from './reset-db.js';

/**
 * Dashboard-Datenquelle (Scale S1, Aufgabe 15).
 *
 * Die Business-Integrity-Abfragen sind der interessante Teil: Sie suchen Zustände,
 * die laut Produktregeln unmöglich sind. Deshalb werden sie hier bewusst **verletzt**
 * — sonst prüft der Test nur, dass eine leere Datenbank leer ist.
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

async function seedChallenge(maxSlots = 10) {
  const creator = await prisma.user.create({ data: { isAdult: true } });
  const challenge = await prisma.challenge.create({
    data: {
      creatorId: creator.id,
      title: 'Metrik',
      status: 'OPEN',
      maxSlots,
      prizeAmountCents: 1000,
      selectionMode: 'CREATOR_DECIDES',
    },
  });
  return { challengeId: challenge.id, creatorId: creator.id };
}

describe('Outbox-Metriken', () => {
  it('meldet leere Outbox ohne Rückstand', async () => {
    const m = await collectOutboxMetrics(prisma);
    expect(m.pending).toBe(0);
    expect(m.oldestPendingAgeMs).toBe(0);
  });

  it('zählt ausstehende Events und misst deren Alter', async () => {
    const { challengeId } = await seedChallenge();
    const u = await prisma.user.create({ data: { isAdult: true } });
    await joinChallenge({ prisma, events: new InMemoryEventPublisher() }, { challengeId, userId: u.id });

    const m = await collectOutboxMetrics(prisma, new Date(Date.now() + 60_000));
    expect(m.pending).toBe(1);
    expect(m.oldestPendingAgeMs).toBeGreaterThan(50_000);
  });

  it('zählt endgültig gescheiterte Events getrennt', async () => {
    await prisma.outboxEvent.create({
      data: { aggregateType: 'x', aggregateId: 'y', eventType: 'z', payload: {}, status: 'FAILED' },
    });
    const m = await collectOutboxMetrics(prisma);
    expect(m.failed).toBe(1);
    expect(m.exhausted).toBe(1);
  });
});

describe('Queue-Metriken', () => {
  it('unterscheidet ausstehend, laufend und gescheitert', async () => {
    await createOperation(prisma, { kind: OperationKind.VIDEO_PROCESSING });
    const running = await createOperation(prisma, { kind: OperationKind.VIDEO_PROCESSING });
    await markRunning(prisma, running.id, 10);

    const m = await collectQueueMetrics(prisma);
    expect(m.asyncOperationsPending).toBe(1);
    expect(m.asyncOperationsRunning).toBe(1);
  });

  it('erkennt hängende Operationen', async () => {
    const op = await createOperation(prisma, { kind: OperationKind.VIDEO_PROCESSING });
    await markRunning(prisma, op.id, 50);

    const frisch = await collectQueueMetrics(prisma);
    expect(frisch.stuckRunning).toBe(0);

    // Weit in der Zukunft betrachtet gilt dieselbe Operation als hängend.
    const spaeter = await collectQueueMetrics(
      prisma,
      new Date(Date.now() + STUCK_OPERATION_MS + 60_000),
    );
    expect(spaeter.stuckRunning).toBe(1);
  });
});

describe('Projektions-Lag', () => {
  it('meldet den Rückstand gegenüber der Outbox', async () => {
    const { challengeId } = await seedChallenge();
    const users = await Promise.all(
      Array.from({ length: 3 }, () => prisma.user.create({ data: { isAdult: true } })),
    );
    for (const u of users) {
      await joinChallenge({ prisma, events: new InMemoryEventPublisher() }, { challengeId, userId: u.id });
    }

    const ohneCheckpoint = await collectProjectionMetrics(prisma);
    expect(ohneCheckpoint.lagEvents).toBe(3);

    await prisma.projectionCheckpoint.create({
      data: { projectionName: 'test', lastSequence: 3n },
    });
    const aufgeholt = await collectProjectionMetrics(prisma);
    expect(aufgeholt.lagEvents).toBe(0);
  });
});

describe('Datenbank- und Replikationsmetriken', () => {
  it('liest echte Verbindungszahlen aus pg_stat_activity', async () => {
    const m = await collectDbMetrics(prisma);
    expect(m.activeConnections).toBeGreaterThan(0);
    expect(m.maxConnections).toBeGreaterThan(0);
    expect(m.utilizationPercent).toBeGreaterThanOrEqual(0);
    expect(m.utilizationPercent).toBeLessThanOrEqual(100);
  });

  it('meldet ohne angebundene Replik null statt zu raten', async () => {
    const m = await collectReplicaMetrics(prisma);
    expect(m.replicaCount).toBe(0);
    expect(m.lagMs).toBeNull();
  });
});

describe('Geschäftsintegrität', () => {
  it('meldet eine saubere Datenbank als gesund', async () => {
    const m = await collectBusinessIntegrity(prisma);
    expect(m.healthy).toBe(true);
    expect(m.challengesOverCapacity).toBe(0);
  });

  it('entdeckt eine überbelegte Challenge', async () => {
    // Regelverstoß bewusst herbeiführen: mehr zählende Slots als maxSlots.
    const { challengeId } = await seedChallenge(2);
    for (let i = 0; i < 3; i += 1) {
      const u = await prisma.user.create({ data: { isAdult: true } });
      await prisma.slot.create({
        data: { challengeId, participantId: u.id, status: 'RESERVED', expiresAt: new Date(Date.now() + 600_000) },
      });
    }

    const m = await collectBusinessIntegrity(prisma);
    expect(m.challengesOverCapacity).toBe(1);
    expect(m.healthy).toBe(false);
  });

  it('entdeckt eine unausgeglichene Ledger-Buchung', async () => {
    const { challengeId } = await seedChallenge();
    // Nur die Soll-Seite buchen — die Bilanz geht nicht auf.
    await prisma.ledgerEntry.create({
      data: {
        challengeId,
        account: 'CHALLENGE_ESCROW',
        direction: 'DEBIT',
        amountCents: 500,
        entryType: 'TESTBUCHUNG',
      },
    });

    const m = await collectBusinessIntegrity(prisma);
    expect(m.unbalancedLedgerGroups).toBe(1);
    expect(m.healthy).toBe(false);
  });

  it('wertet eine vollständige doppelte Buchung als ausgeglichen', async () => {
    const { challengeId } = await seedChallenge();
    await prisma.ledgerEntry.createMany({
      data: [
        { challengeId, account: 'A', direction: 'DEBIT', amountCents: 500, entryType: 'PAAR' },
        { challengeId, account: 'B', direction: 'CREDIT', amountCents: 500, entryType: 'PAAR' },
      ],
    });
    const m = await collectBusinessIntegrity(prisma);
    expect(m.unbalancedLedgerGroups).toBe(0);
    expect(m.healthy).toBe(true);
  });
});

describe('Gesamtaufnahme', () => {
  it('liefert alle sechs Bereiche in einem Aufruf', async () => {
    const snapshot = await collectMetrics(prisma);
    expect(snapshot.collectedAt).toBeTruthy();
    expect(snapshot.outbox).toBeDefined();
    expect(snapshot.queue).toBeDefined();
    expect(snapshot.projection).toBeDefined();
    expect(snapshot.db).toBeDefined();
    expect(snapshot.replica).toBeDefined();
    expect(snapshot.businessIntegrity.healthy).toBe(true);
  });
});
