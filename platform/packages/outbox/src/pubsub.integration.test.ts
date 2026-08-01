import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createBrokerPublisher, toBrokerMessage } from './publishers.js';
import type { OutboxEventRecord } from './types.js';

/**
 * Publisher- und Consumer-Seite gegen einen **echten** Pub/Sub — den offiziellen
 * Emulator, angesprochen über den echten `@google-cloud/pubsub`-Client.
 *
 * Warum das nötig ist, obwohl es Unit-Tests gegen `TopicClient` gibt: Die Doubles
 * bestätigen nur, dass der Adapter aufruft, was der Adapter aufrufen soll. Sie können
 * nicht zeigen, ob der echte Client die Nachricht überhaupt annimmt. Genau dort liegen
 * die teuren Überraschungen:
 *
 *   • Ein `orderingKey` **ohne** `enableMessageOrdering` am Publisher wird vom Client
 *     abgelehnt — der Ordering Key aus `toBrokerMessage` wäre wirkungslos.
 *   • Attributwerte müssen Strings sein; `sequence` ist ein BigInt und wird konvertiert.
 *   • Ordering-Garantien gelten je Key, nicht global.
 *
 * Der Test überspringt sich sauber ohne laufenden Emulator (`PUBSUB_EMULATOR_HOST`),
 * damit CI ohne Java nicht rot wird.
 */

const EMULATOR = process.env.PUBSUB_EMULATOR_HOST;
const maybe = EMULATOR ? describe : describe.skip;

const PROJECT = 'vcp-test';

interface PubSubLike {
  createTopic(name: string): Promise<unknown>;
  topic(name: string, options?: Record<string, unknown>): {
    publishMessage(msg: Record<string, unknown>): Promise<string>;
    createSubscription(name: string, options?: Record<string, unknown>): Promise<unknown>;
    delete(): Promise<unknown>;
  };
  subscription(name: string): SubscriptionLike;
}

interface SubscriptionLike {
  on(event: string, handler: (arg: never) => void): void;
  close(): Promise<void>;
}

interface ReceivedMessage {
  readonly id: string;
  readonly data: Buffer;
  readonly attributes: Record<string, string>;
  readonly orderingKey?: string;
  ack(): void;
  nack(): void;
}

function ereignis(over: Partial<OutboxEventRecord> = {}): OutboxEventRecord {
  return {
    sequence: 1n,
    eventId: '11111111-1111-4111-8111-111111111111',
    eventType: 'challenge.slot_reserved',
    aggregateType: 'challenge',
    aggregateId: 'c1',
    payload: { slots: 3 },
    status: 'PENDING',
    attempts: 0,
    availableAt: new Date(0),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    publishedAt: null,
    lastError: null,
    ...over,
  } as OutboxEventRecord;
}

maybe('Gegen echtes Pub/Sub (Emulator)', () => {
  let PubSub: new (opts: Record<string, unknown>) => PubSubLike;
  let client: PubSubLike;
  let topicName: string;
  let subName: string;

  beforeAll(async () => {
    const mod = (await import('@google-cloud/pubsub')) as unknown as {
      PubSub: typeof PubSub;
    };
    PubSub = mod.PubSub;
    client = new PubSub({ projectId: PROJECT });
  });

  beforeEach(async () => {
    // Eigene Namen je Test: Der Emulator hält den Zustand über den ganzen Lauf.
    const id = Math.random().toString(36).slice(2, 10);
    topicName = `challenge-events-${id}`;
    subName = `challenge-projection-${id}`;
    await client.createTopic(topicName);
    await client
      .topic(topicName)
      .createSubscription(subName, { enableMessageOrdering: true, ackDeadlineSeconds: 30 });
  });

  afterEach(async () => {
    await client.topic(topicName).delete().catch(() => undefined);
  });

  afterAll(async () => {
    // Kein expliziter close nötig; der Emulator-Prozess wird extern beendet.
  });

  /** Sammelt `count` Nachrichten oder bricht nach `timeoutMs` ab. */
  async function empfange(count: number, timeoutMs = 15_000): Promise<ReceivedMessage[]> {
    const sub = client.subscription(subName);
    const gesammelt: ReceivedMessage[] = [];
    return new Promise<ReceivedMessage[]>((resolve, reject) => {
      const fertig = (fn: () => void): void => {
        clearTimeout(timer);
        void sub.close().then(fn, fn);
      };
      const timer = setTimeout(
        () => fertig(() => reject(new Error(`Nur ${gesammelt.length} von ${count} Nachrichten erhalten.`))),
        timeoutMs,
      );
      sub.on('error', ((err: Error) => fertig(() => reject(err))) as never);
      sub.on('message', ((msg: ReceivedMessage) => {
        gesammelt.push(msg);
        msg.ack();
        if (gesammelt.length >= count) fertig(() => resolve(gesammelt));
      }) as never);
    });
  }

  it('nimmt eine Nachricht des echten Adapters an und stellt sie zu', async () => {
    // `messageOrdering: true` ist Pflicht, sobald ein orderingKey gesetzt wird —
    // ohne die Option lehnt der Client die Veröffentlichung ab.
    const topic = client.topic(topicName, { messageOrdering: true });
    await createBrokerPublisher(topic).publish([ereignis()]);

    const [msg] = await empfange(1);
    const body = JSON.parse(msg!.data.toString('utf8')) as Record<string, unknown>;

    expect(body.eventType).toBe('challenge.slot_reserved');
    expect(body.aggregateId).toBe('c1');
    // BigInt überlebt JSON nicht — deshalb als String. Der Consumer wandelt zurück.
    expect(body.sequence).toBe('1');
    expect(body.payload).toEqual({ slots: 3 });
  });

  it('überträgt den Deduplizierungsschlüssel als Attribut', async () => {
    // Ohne eventId im Attribut könnte die Consumer-Inbox nicht deduplizieren, und
    // die at-least-once-Zustellung würde zu doppelten Effekten führen.
    const topic = client.topic(topicName, { messageOrdering: true });
    const ev = ereignis({ eventId: '22222222-2222-4222-8222-222222222222' });
    await createBrokerPublisher(topic).publish([ev]);

    const [msg] = await empfange(1);
    expect(msg!.attributes.eventId).toBe('22222222-2222-4222-8222-222222222222');
    expect(msg!.attributes.sequence).toBe('1');
    expect(msg!.attributes.aggregateType).toBe('challenge');
  });

  it('hält die Reihenfolge innerhalb eines Aggregats ein', async () => {
    const topic = client.topic(topicName, { messageOrdering: true });
    const events = [1n, 2n, 3n, 4n, 5n].map((seq) =>
      ereignis({
        sequence: seq,
        eventId: `3333333${seq}-3333-4333-8333-333333333333`,
        aggregateId: 'gleiche-challenge',
      }),
    );
    await createBrokerPublisher(topic).publish(events);

    const empfangen = await empfange(5);
    expect(empfangen.map((m) => m.attributes.sequence)).toEqual(['1', '2', '3', '4', '5']);
    // Alle teilen denselben Ordering Key — genau darauf beruht die Garantie.
    expect(new Set(empfangen.map((m) => m.orderingKey))).toEqual(
      new Set(['challenge:gleiche-challenge']),
    );
  });

  it('vergibt je Aggregat einen eigenen Ordering Key', async () => {
    // Wäre der Key global, würde ein langsames Aggregat alle anderen ausbremsen.
    const topic = client.topic(topicName, { messageOrdering: true });
    await createBrokerPublisher(topic).publish([
      ereignis({ sequence: 1n, eventId: '44444444-4444-4444-8444-444444444441', aggregateId: 'a' }),
      ereignis({ sequence: 2n, eventId: '44444444-4444-4444-8444-444444444442', aggregateId: 'b' }),
    ]);

    const empfangen = await empfange(2);
    expect(new Set(empfangen.map((m) => m.orderingKey))).toEqual(
      new Set(['challenge:a', 'challenge:b']),
    );
  });

  it('stellt eine mit nack zurückgegebene Nachricht erneut zu', async () => {
    // Der Grund, warum die Inbox idempotent sein muss: Ein Fehler im Consumer führt
    // zu einer zweiten Zustellung derselben Nachricht, nicht zu ihrem Verlust.
    const topic = client.topic(topicName, { messageOrdering: true });
    await createBrokerPublisher(topic).publish([ereignis()]);

    const sub = client.subscription(subName);
    const ids: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        void sub.close().then(() => reject(new Error('Keine zweite Zustellung erhalten.')));
      }, 20_000);
      sub.on('message', ((msg: ReceivedMessage) => {
        ids.push(msg.id);
        if (ids.length === 1) {
          msg.nack();
          return;
        }
        msg.ack();
        clearTimeout(timer);
        void sub.close().then(resolve, reject);
      }) as never);
      sub.on('error', ((err: Error) => {
        clearTimeout(timer);
        void sub.close().then(() => reject(err));
      }) as never);
    });

    expect(ids.length).toBeGreaterThanOrEqual(2);
    // Dieselbe Nachricht, nicht eine neue — deshalb greift die Deduplizierung.
    expect(ids[0]).toBe(ids[1]);
  }, 30_000);

});

/**
 * Diese Prüfung läuft **immer**, auch ohne Emulator — und gerade deshalb.
 *
 * Gegen den Emulator wurde gemessen: Eine Nachricht mit `orderingKey`, aber ohne
 * `messageOrdering: true` am Topic-Client wird klaglos angenommen und der Key sogar
 * an den Empfänger durchgereicht. Der Emulator erzwingt die Regel also nicht. Ein
 * Test, der sich darauf verlässt, würde eine Emulator-Eigenheit festschreiben statt
 * einer Produktionsaussage — und wäre schlechter als kein Test.
 *
 * Die Regel selbst bleibt: Ohne die Option gibt es keine Reihenfolgegarantie, und
 * der Key in `toBrokerMessage` wäre Dekoration. Da sich das hier nicht empirisch
 * absichern lässt, wird es strukturell abgesichert.
 */
describe('Der Produktions-Publisher aktiviert die Reihenfolge', () => {
  it('setzt messageOrdering am Topic-Client', () => {
    const quelle = readFileSync(
      new URL('../../../apps/workers/src/run-outbox-publisher.ts', import.meta.url),
      'utf8',
    );
    expect(quelle).toMatch(/messageOrdering:\s*true/);
  });

  it('vergibt überhaupt einen Ordering Key je Aggregat', () => {
    // Ohne Key hilft die aktivierte Reihenfolge nichts.
    expect(toBrokerMessage(ereignis({ aggregateId: 'xyz' })).orderingKey).toBe('challenge:xyz');
  });

  it('deklariert den Pub/Sub-Client als Abhängigkeit des Workers', () => {
    // Der Client wird über einen Variablen-Spezifizierer geladen, damit TypeScript
    // ihn nicht statisch auflöst — dadurch fällt ein fehlender Eintrag im Manifest
    // aber weder beim Typecheck noch beim Build auf. In Cloud Run setzt Terraform
    // PUBSUB_TOPIC immer, und der Worker bricht dann fail-closed ab. Genau dieser
    // Startfehler ließe sich sonst erst im Deployment beobachten.
    const manifest = JSON.parse(
      readFileSync(new URL('../../../apps/workers/package.json', import.meta.url), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    expect(manifest.dependencies?.['@google-cloud/pubsub']).toBeDefined();
  });
});
