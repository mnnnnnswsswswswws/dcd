import { describe, expect, it, vi } from 'vitest';
import { OutboxPublisher, backoffDelayMs, outboxLagMs } from './publisher.js';
import {
  HandlerOutcome,
  IdempotentHandler,
  isUniqueViolation,
  type InboundMessage,
  type InboxStore,
  type SequenceTracker,
} from './inbox.js';
import { OutboxStatus, type EventPublisher, type OutboxEventRecord, type OutboxStore } from './types.js';

/* ------------------------- Test-Doubles (in-memory) ------------------------- */

/**
 * In-Memory-Store, der den Vertrag von `claimBatch` exakt nachbildet: Status auf
 * PUBLISHING, attempts +1, Sichtbarkeits-Timeout. Nur so testen wir dieselbe
 * Semantik, die die Prisma-Implementierung liefert.
 */
class MemoryStore implements OutboxStore {
  events: OutboxEventRecord[] = [];
  private seq = 0n;
  constructor(private visibilityMs = 60_000) {}

  add(over: Partial<OutboxEventRecord> = {}): OutboxEventRecord {
    this.seq += 1n;
    const e: OutboxEventRecord = {
      sequence: this.seq,
      eventId: `evt-${this.seq}`,
      aggregateType: 'challenge',
      aggregateId: 'c1',
      eventType: 'challenge.published',
      payload: {},
      status: OutboxStatus.PENDING,
      attempts: 0,
      availableAt: new Date(0),
      createdAt: new Date(0),
      ...over,
    };
    this.events.push(e);
    return e;
  }

  async claimBatch(limit: number, now: Date): Promise<OutboxEventRecord[]> {
    const due = this.events
      .filter(
        (e) =>
          (e.status === OutboxStatus.PENDING || e.status === OutboxStatus.PUBLISHING) &&
          e.availableAt.getTime() <= now.getTime(),
      )
      .sort((a, b) => Number(a.sequence - b.sequence))
      .slice(0, limit);

    return due.map((e) => {
      const claimed: OutboxEventRecord = {
        ...e,
        status: OutboxStatus.PUBLISHING,
        attempts: e.attempts + 1,
        availableAt: new Date(now.getTime() + this.visibilityMs),
      };
      this.replace(claimed);
      return claimed;
    });
  }

  async markPublished(sequences: readonly bigint[], now: Date): Promise<void> {
    for (const s of sequences) {
      const e = this.find(s);
      if (e) this.replace({ ...e, status: OutboxStatus.PUBLISHED, publishedAt: now });
    }
  }

  async markFailed(
    sequence: bigint,
    error: string,
    retryAt: Date | null,
    _now?: Date,
  ): Promise<void> {
    const e = this.find(sequence);
    if (!e) return;
    this.replace(
      retryAt === null
        ? { ...e, status: OutboxStatus.FAILED, lastError: error }
        : { ...e, status: OutboxStatus.PENDING, lastError: error, availableAt: retryAt },
    );
  }

  find(s: bigint) {
    return this.events.find((e) => e.sequence === s);
  }
  private replace(e: OutboxEventRecord) {
    this.events = this.events.map((x) => (x.sequence === e.sequence ? e : x));
  }
}

class MemoryInbox implements InboxStore {
  seen = new Set<string>();
  async tryMarkProcessed(messageId: string, handlerName: string): Promise<boolean> {
    const key = `${messageId}::${handlerName}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }
  async release(messageId: string, handlerName: string): Promise<void> {
    this.seen.delete(`${messageId}::${handlerName}`);
  }
}

const okPublisher = (): EventPublisher & { sent: OutboxEventRecord[] } => {
  const sent: OutboxEventRecord[] = [];
  return { sent, async publish(events) { sent.push(...events); } };
};

/* --------------------------------- Tests --------------------------------- */

describe('Outbox-Publisher', () => {
  it('veröffentlicht fällige Events und markiert sie', async () => {
    const store = new MemoryStore();
    store.add();
    store.add();
    const pub = okPublisher();
    const r = await new OutboxPublisher(store, pub).runOnce();

    expect(r.claimed).toBe(2);
    expect(r.published).toBe(2);
    expect(pub.sent).toHaveLength(2);
    expect(store.events.every((e) => e.status === OutboxStatus.PUBLISHED)).toBe(true);
  });

  it('hält die Reihenfolge nach Sequenz ein', async () => {
    const store = new MemoryStore();
    store.add();
    store.add();
    store.add();
    const pub = okPublisher();
    await new OutboxPublisher(store, pub).runOnce();
    expect(pub.sent.map((e) => Number(e.sequence))).toEqual([1, 2, 3]);
  });

  it('gibt die eventId als Deduplizierungsschlüssel mit', async () => {
    const store = new MemoryStore();
    store.add({ eventId: 'stable-id' });
    const pub = okPublisher();
    await new OutboxPublisher(store, pub).runOnce();
    expect(pub.sent[0]?.eventId).toBe('stable-id');
  });

  it('tut nichts, wenn nichts fällig ist', async () => {
    const store = new MemoryStore();
    store.add({ availableAt: new Date('2999-01-01') });
    const r = await new OutboxPublisher(store, okPublisher(), {
      now: () => new Date('2026-07-28'),
    }).runOnce();
    expect(r.claimed).toBe(0);
  });

  it('setzt nach einem Publish-Fehler auf PENDING mit Backoff zurück', async () => {
    const store = new MemoryStore();
    store.add();
    const failing: EventPublisher = {
      async publish() {
        throw new Error('pubsub down');
      },
    };
    const now = new Date('2026-07-28T12:00:00Z');
    const r = await new OutboxPublisher(store, failing, { now: () => now }).runOnce();

    expect(r.failed).toBe(1);
    expect(r.published).toBe(0);
    const e = store.find(1n)!;
    expect(e.status).toBe(OutboxStatus.PENDING);
    expect(e.lastError).toContain('pubsub down');
    expect(e.availableAt.getTime()).toBeGreaterThanOrEqual(now.getTime());
  });

  it('gibt nach maxAttempts endgültig auf und meldet das', async () => {
    const store = new MemoryStore();
    store.add({ attempts: 2 }); // claim erhöht auf 3
    const failing: EventPublisher = {
      async publish() {
        throw new Error('kaputt');
      },
    };
    const onExhausted = vi.fn();
    const r = await new OutboxPublisher(store, failing, {
      maxAttempts: 3,
      metrics: { onExhausted },
    }).runOnce();

    expect(r.exhausted).toBe(1);
    expect(store.find(1n)?.status).toBe(OutboxStatus.FAILED);
    expect(onExhausted).toHaveBeenCalledOnce();
  });

  it('zählt Versuche genau einmal je Durchlauf (kein Doppel-Increment)', async () => {
    const store = new MemoryStore();
    store.add();
    const failing: EventPublisher = {
      async publish() {
        throw new Error('x');
      },
    };
    await new OutboxPublisher(store, failing, { backoffBaseMs: 0 }).runOnce();
    expect(store.find(1n)?.attempts).toBe(1);
  });

  it('macht ein verwaistes PUBLISHING nach dem Sichtbarkeits-Timeout wieder greifbar', async () => {
    // Simuliert: Publisher stürzt nach dem Beanspruchen ab.
    const store = new MemoryStore(1_000);
    store.add();
    const t0 = new Date('2026-07-28T12:00:00Z');
    await store.claimBatch(10, t0);
    expect(store.find(1n)?.status).toBe(OutboxStatus.PUBLISHING);

    // Vor Ablauf: nicht greifbar.
    expect(await store.claimBatch(10, new Date(t0.getTime() + 500))).toHaveLength(0);
    // Nach Ablauf: erneut greifbar — Event geht nicht verloren.
    const again = await store.claimBatch(10, new Date(t0.getTime() + 2_000));
    expect(again).toHaveLength(1);
    expect(again[0]?.attempts).toBe(2);
  });

  it('Publisher-Crash NACH publish führt zu erneuter Zustellung, nicht zu Verlust', async () => {
    const store = new MemoryStore(1_000);
    store.add();
    const pub = okPublisher();
    const t0 = new Date('2026-07-28T12:00:00Z');

    // Erster Lauf: publish gelingt, markPublished wird durch den "Absturz" verhindert.
    const crashingStore: OutboxStore = {
      claimBatch: (l, n) => store.claimBatch(l, n),
      markPublished: async () => {
        throw new Error('crash vor markPublished');
      },
      markFailed: (s, e, r, n) => store.markFailed(s, e, r, n),
    };
    await new OutboxPublisher(crashingStore, pub, { now: () => t0, backoffBaseMs: 0 }).runOnce();
    expect(pub.sent).toHaveLength(1);

    // Zweiter Lauf nach Timeout: dasselbe Event kommt erneut — at-least-once.
    await new OutboxPublisher(store, pub, {
      now: () => new Date(t0.getTime() + 5_000),
    }).runOnce();
    expect(pub.sent).toHaveLength(2);
    expect(pub.sent[0]?.eventId).toBe(pub.sent[1]?.eventId);
  });

  it('drain arbeitet mehrere Batches ab', async () => {
    const store = new MemoryStore();
    for (let i = 0; i < 5; i += 1) store.add();
    const pub = okPublisher();
    const r = await new OutboxPublisher(store, pub, { batchSize: 2 }).drain();
    expect(r.published).toBe(5);
  });
});

describe('Backoff', () => {
  it('wächst exponentiell und ist gedeckelt', () => {
    const max = () => 1; // Jitter auf Maximum
    expect(backoffDelayMs(1, 1_000, 60_000, max)).toBe(1_000);
    expect(backoffDelayMs(2, 1_000, 60_000, max)).toBe(2_000);
    expect(backoffDelayMs(3, 1_000, 60_000, max)).toBe(4_000);
    expect(backoffDelayMs(50, 1_000, 60_000, max)).toBe(60_000);
  });

  it('streut, damit Publisher nicht im Gleichtakt erneut zuschlagen', () => {
    expect(backoffDelayMs(5, 1_000, 60_000, () => 0)).toBe(0);
    expect(backoffDelayMs(5, 1_000, 60_000, () => 0.5)).toBeLessThan(
      backoffDelayMs(5, 1_000, 60_000, () => 1),
    );
  });
});

describe('Outbox-Lag', () => {
  it('meldet 0 ohne Rückstand', () => {
    expect(outboxLagMs(undefined, new Date())).toBe(0);
  });
  it('misst das Alter des ältesten unveröffentlichten Events', () => {
    const store = new MemoryStore();
    const e = store.add({ createdAt: new Date('2026-07-28T12:00:00Z') });
    expect(outboxLagMs(e, new Date('2026-07-28T12:00:30Z'))).toBe(30_000);
  });
});

describe('Consumer-Inbox: Idempotenz', () => {
  const msg = (over: Partial<InboundMessage> = {}): InboundMessage => ({
    messageId: 'm1',
    eventType: 'challenge.published',
    aggregateType: 'challenge',
    aggregateId: 'c1',
    payload: {},
    ...over,
  });

  it('führt den Effekt bei Erstzustellung aus', async () => {
    const inbox = new MemoryInbox();
    const effect = vi.fn(async () => {});
    const h = new IdempotentHandler({ name: 'projector', store: inbox }, effect);
    const r = await h.handle(msg());
    expect(r.outcome).toBe(HandlerOutcome.PROCESSED);
    expect(effect).toHaveBeenCalledOnce();
  });

  it('überspringt eine doppelte Zustellung ohne Nebenwirkung', async () => {
    const inbox = new MemoryInbox();
    const effect = vi.fn(async () => {});
    const h = new IdempotentHandler({ name: 'projector', store: inbox }, effect);
    await h.handle(msg());
    const second = await h.handle(msg());
    expect(second.outcome).toBe(HandlerOutcome.DUPLICATE_SKIPPED);
    expect(effect).toHaveBeenCalledOnce();
  });

  it('lässt verschiedene Handler dieselbe Nachricht je einmal verarbeiten', async () => {
    const inbox = new MemoryInbox();
    const a = vi.fn(async () => {});
    const b = vi.fn(async () => {});
    await new IdempotentHandler({ name: 'projection', store: inbox }, a).handle(msg());
    await new IdempotentHandler({ name: 'notification', store: inbox }, b).handle(msg());
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it('gibt die Markierung bei Fehlschlag frei, damit der Retry greift', async () => {
    const inbox = new MemoryInbox();
    let calls = 0;
    const effect = async () => {
      calls += 1;
      if (calls === 1) throw new Error('transient');
    };
    const h = new IdempotentHandler(
      { name: 'projector', store: inbox },
      effect,
      (id, name) => inbox.release(id, name),
    );
    const first = await h.handle(msg());
    expect(first.outcome).toBe(HandlerOutcome.FAILED);

    const retry = await h.handle(msg());
    expect(retry.outcome).toBe(HandlerOutcome.PROCESSED);
    expect(calls).toBe(2);
  });
});

describe('Consumer-Inbox: Out-of-order', () => {
  const tracker = (): SequenceTracker & { state: Map<string, bigint> } => {
    const state = new Map<string, bigint>();
    return {
      state,
      async lastApplied(t, id) {
        return state.get(`${t}:${id}`);
      },
      async record(t, id, seq) {
        state.set(`${t}:${id}`, seq);
      },
    };
  };

  it('verwirft eine veraltete Nachricht, statt neueren Zustand zu überschreiben', async () => {
    const inbox = new MemoryInbox();
    const seq = tracker();
    const effect = vi.fn(async () => {});
    const opts = { name: 'projection', store: inbox, sequenceTracker: seq };

    // Neuere Nachricht zuerst (Pub/Sub liefert unsortiert).
    await new IdempotentHandler(opts, effect).handle({
      messageId: 'm-new',
      eventType: 'x',
      aggregateType: 'challenge',
      aggregateId: 'c1',
      payload: {},
      sequence: 10n,
    });
    // Danach die ältere.
    const stale = await new IdempotentHandler(opts, effect).handle({
      messageId: 'm-old',
      eventType: 'x',
      aggregateType: 'challenge',
      aggregateId: 'c1',
      payload: {},
      sequence: 5n,
    });

    expect(stale.outcome).toBe(HandlerOutcome.STALE_SKIPPED);
    expect(effect).toHaveBeenCalledOnce();
    expect(seq.state.get('challenge:c1')).toBe(10n);
  });

  it('verarbeitet aufsteigende Sequenzen normal', async () => {
    const inbox = new MemoryInbox();
    const seq = tracker();
    const effect = vi.fn(async () => {});
    const opts = { name: 'projection', store: inbox, sequenceTracker: seq };
    for (const [id, s] of [['a', 1n], ['b', 2n], ['c', 3n]] as const) {
      await new IdempotentHandler(opts, effect).handle({
        messageId: id,
        eventType: 'x',
        aggregateType: 'challenge',
        aggregateId: 'c1',
        payload: {},
        sequence: s,
      });
    }
    expect(effect).toHaveBeenCalledTimes(3);
    expect(seq.state.get('challenge:c1')).toBe(3n);
  });

  it('trennt Sequenzen je Aggregat', async () => {
    const inbox = new MemoryInbox();
    const seq = tracker();
    const effect = vi.fn(async () => {});
    const opts = { name: 'projection', store: inbox, sequenceTracker: seq };
    await new IdempotentHandler(opts, effect).handle({
      messageId: 'a', eventType: 'x', aggregateType: 'challenge', aggregateId: 'c1', payload: {}, sequence: 10n,
    });
    // Anderes Aggregat mit kleinerer Sequenz ist NICHT veraltet.
    const other = await new IdempotentHandler(opts, effect).handle({
      messageId: 'b', eventType: 'x', aggregateType: 'challenge', aggregateId: 'c2', payload: {}, sequence: 2n,
    });
    expect(other.outcome).toBe(HandlerOutcome.PROCESSED);
  });
});

describe('Unique-Violation-Erkennung', () => {
  it('erkennt Prisma P2002 und Postgres 23505', () => {
    expect(isUniqueViolation({ code: 'P2002' })).toBe(true);
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
  });
  it('lässt echte Fehler durch', () => {
    expect(isUniqueViolation(new Error('connection reset'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});
