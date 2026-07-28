/**
 * Integrationstest gegen eine echte PostgreSQL-Instanz.
 *
 * Prüft die Eigenschaft, die sich mit In-Memory-Doubles gerade NICHT beweisen lässt:
 * dass `FOR UPDATE SKIP LOCKED` zwei gleichzeitig laufende Publisher sauber trennt
 * und kein Event doppelt beansprucht wird.
 *
 * Läuft nur, wenn DATABASE_URL gesetzt ist — sonst wird die Suite übersprungen,
 * damit der normale Unit-Test-Lauf ohne Datenbank grün bleibt.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaOutboxStore, createOutboxWriter, type PrismaLike } from './prisma-store.js';
import { OutboxPublisher } from './publisher.js';
import type { EventPublisher, OutboxEventRecord } from './types.js';

const DB = process.env.DATABASE_URL;
const maybe = DB ? describe : describe.skip;

maybe('Prisma-Outbox-Store gegen echtes PostgreSQL', () => {
  let prisma: PrismaLike & { $disconnect(): Promise<void>; $executeRawUnsafe(q: string): Promise<number> };

  beforeAll(async () => {
    const { PrismaClient } = (await import('@prisma/client')) as unknown as {
      PrismaClient: new () => typeof prisma;
    };
    prisma = new PrismaClient();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "outbox_events" RESTART IDENTITY;');
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('schreibt Events und beansprucht sie in Sequenzreihenfolge', async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "outbox_events" RESTART IDENTITY;');
    const writer = createOutboxWriter(prisma);
    for (let i = 0; i < 5; i += 1) {
      await writer.insert({
        aggregateType: 'challenge',
        aggregateId: `c${i}`,
        eventType: 'challenge.published',
        payload: { i },
      });
    }

    const store = createPrismaOutboxStore(prisma);
    const claimed = await store.claimBatch(10, new Date());
    expect(claimed).toHaveLength(5);
    expect(claimed.map((e) => Number(e.sequence))).toEqual([1, 2, 3, 4, 5]);
    // claimBatch erhöht attempts — Vertrag aus types.ts.
    expect(claimed.every((e) => e.attempts === 1)).toBe(true);
    expect(claimed.every((e) => e.status === 'PUBLISHING')).toBe(true);
  });

  it('trennt zwei parallele Publisher ohne Doppelbeanspruchung', async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "outbox_events" RESTART IDENTITY;');
    const writer = createOutboxWriter(prisma);
    for (let i = 0; i < 40; i += 1) {
      await writer.insert({
        aggregateType: 'challenge',
        aggregateId: `c${i}`,
        eventType: 'slot.reserved',
        payload: { i },
      });
    }

    const store = createPrismaOutboxStore(prisma);
    const now = new Date();
    // Zwei Publisher greifen gleichzeitig zu.
    const [a, b] = await Promise.all([store.claimBatch(20, now), store.claimBatch(20, now)]);

    const seqA = a.map((e) => e.sequence.toString());
    const seqB = b.map((e) => e.sequence.toString());
    const overlap = seqA.filter((s) => seqB.includes(s));

    expect(overlap).toHaveLength(0); // ← die eigentliche Zusage
    expect(new Set([...seqA, ...seqB]).size).toBe(a.length + b.length);
  });

  it('macht ein verwaistes PUBLISHING nach dem Sichtbarkeits-Timeout wieder greifbar', async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "outbox_events" RESTART IDENTITY;');
    await createOutboxWriter(prisma).insert({
      aggregateType: 'payout',
      aggregateId: 'p1',
      eventType: 'payout.transfer_created',
      payload: {},
    });

    const store = createPrismaOutboxStore(prisma, 1_000);
    const t0 = new Date();
    expect(await store.claimBatch(10, t0)).toHaveLength(1);
    // Innerhalb des Timeouts unsichtbar …
    expect(await store.claimBatch(10, new Date(t0.getTime() + 500))).toHaveLength(0);
    // … danach wieder greifbar, damit nichts verloren geht.
    const again = await store.claimBatch(10, new Date(t0.getTime() + 2_000));
    expect(again).toHaveLength(1);
    expect(again[0]?.attempts).toBe(2);
  });

  it('markiert veröffentlichte Events und beansprucht sie nicht erneut', async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "outbox_events" RESTART IDENTITY;');
    const writer = createOutboxWriter(prisma);
    await writer.insert({
      aggregateType: 'challenge', aggregateId: 'c1', eventType: 'winner.locked', payload: {},
    });

    const store = createPrismaOutboxStore(prisma);
    const sent: OutboxEventRecord[] = [];
    const pub: EventPublisher = { async publish(e) { sent.push(...e); } };

    const r = await new OutboxPublisher(store, pub).runOnce();
    expect(r.published).toBe(1);
    expect(sent).toHaveLength(1);

    // Weit in der Zukunft erneut versuchen: nichts mehr fällig.
    const later = await store.claimBatch(10, new Date(Date.now() + 3_600_000));
    expect(later).toHaveLength(0);
  });

  it('setzt nach einem Fehler auf PENDING mit Backoff und liefert später erneut', async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "outbox_events" RESTART IDENTITY;');
    await createOutboxWriter(prisma).insert({
      aggregateType: 'challenge', aggregateId: 'c9', eventType: 'moderation.hold', payload: {},
    });

    const store = createPrismaOutboxStore(prisma);
    const failing: EventPublisher = { async publish() { throw new Error('broker weg'); } };
    const t0 = new Date();
    const r = await new OutboxPublisher(store, failing, {
      now: () => t0, backoffBaseMs: 10, maxAttempts: 5,
    }).runOnce();
    expect(r.failed).toBe(1);

    const rows = await prisma.$queryRawUnsafe<Array<{ status: string; last_error: string }>>(
      'SELECT "status", "last_error" FROM "outbox_events" WHERE "sequence" = 1;',
    );
    expect(rows[0]?.status).toBe('PENDING');
    expect(rows[0]?.last_error).toContain('broker weg');
  });
});
