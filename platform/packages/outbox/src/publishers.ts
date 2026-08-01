/**
 * Broker-Adapter für den Outbox-Publisher.
 *
 * Der eigentliche Zustelldienst (Google Cloud Pub/Sub) wird über einen schmalen Port
 * angebunden, damit hier keine Cloud-Abhängigkeit im Code liegt und die Logik ohne
 * Credentials testbar bleibt. Der echte Client wird beim Deploy injiziert.
 *
 * Zwei Dinge gibt jeder Adapter zwingend mit:
 *   • `eventId` als Deduplizierungsschlüssel — der Consumer braucht ihn, um die
 *     at-least-once-Zustellung idempotent zu machen;
 *   • `aggregateId` als Ordering Key — Pub/Sub garantiert Reihenfolge nur je
 *     Ordering Key, und fachlich zählt sie ohnehin nur innerhalb eines Aggregats.
 */

import type { EventPublisher, OutboxEventRecord } from './types.js';

/** Was ein Broker-Client mindestens können muss. Entspricht `topic.publishMessage`. */
export interface TopicClient {
  publishMessage(message: {
    data: Buffer | Uint8Array;
    attributes?: Record<string, string>;
    orderingKey?: string;
  }): Promise<string>;
}

/** Serialisiert ein Outbox-Event zur Broker-Nachricht. */
export function toBrokerMessage(event: OutboxEventRecord): {
  data: Buffer;
  attributes: Record<string, string>;
  orderingKey: string;
} {
  return {
    data: Buffer.from(
      JSON.stringify({
        eventId: event.eventId,
        eventType: event.eventType,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        sequence: event.sequence.toString(),
        payload: event.payload,
        occurredAt: event.createdAt.toISOString(),
      }),
      'utf8',
    ),
    attributes: {
      // Deduplizierungsschlüssel für die Consumer-Inbox.
      eventId: event.eventId,
      eventType: event.eventType,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      sequence: event.sequence.toString(),
    },
    orderingKey: `${event.aggregateType}:${event.aggregateId}`,
  };
}

/**
 * Publisher gegen einen echten Broker.
 *
 * Zustellung **parallel über Ordering Keys hinweg, sequenziell innerhalb eines
 * Keys**. Beides ist notwendig, und die Kombination ist der ganze Punkt:
 *
 *   • Sequenziell innerhalb eines Keys, weil die Reihenfolge je Aggregat die
 *     Garantie ist, für die der Key überhaupt existiert. Zwei Ereignisse derselben
 *     Challenge gleichzeitig loszuschicken gibt sie preis.
 *   • Parallel über Keys hinweg, weil unterschiedliche Aggregate nichts miteinander
 *     zu tun haben. Vorher lief hier ein einzelnes `await` je Ereignis über den
 *     gesamten Stapel — bei einer Netzwerk-Umlaufzeit von 20 ms sind das 50
 *     Ereignisse pro Sekunde, unabhängig davon, wie viel Arbeit anliegt. Das war
 *     keine bewusste Auslegung, sondern eine Schleife.
 *
 * Bei einem Fehler schlägt der ganze Batch fehl und wird erneut zugestellt. Das
 * bleibt korrekt, weil die Consumer idempotent sind, und ist einfacher als eine
 * partielle Buchführung.
 */
export function createBrokerPublisher(
  topic: TopicClient,
  maxConcurrentKeys = DEFAULT_MAX_CONCURRENT_KEYS,
): EventPublisher {
  return {
    async publish(events: readonly OutboxEventRecord[]): Promise<void> {
      // Nach Ordering Key gruppieren; die Reihenfolge innerhalb einer Gruppe bleibt
      // die Reihenfolge der Sequenz, weil der Store bereits sortiert liefert.
      const gruppen = new Map<string, OutboxEventRecord[]>();
      for (const event of events) {
        const key = `${event.aggregateType}:${event.aggregateId}`;
        const gruppe = gruppen.get(key);
        if (gruppe === undefined) gruppen.set(key, [event]);
        else gruppe.push(event);
      }

      // Begrenzte Nebenläufigkeit: Ohne Obergrenze würde ein großer Rückstand
      // tausende gleichzeitige Zustellungen öffnen und den Broker-Client sowie das
      // Verbindungsbudget überrennen — der Rückstand würde die Störung verschärfen,
      // die ihn verursacht hat.
      const warteschlange = [...gruppen.values()];
      const laeufer = Array.from(
        { length: Math.min(maxConcurrentKeys, warteschlange.length) },
        async () => {
          for (;;) {
            const gruppe = warteschlange.shift();
            if (gruppe === undefined) return;
            for (const event of gruppe) {
              await topic.publishMessage(toBrokerMessage(event));
            }
          }
        },
      );
      await Promise.all(laeufer);
    },
  };
}

/**
 * Gleichzeitig bediente Ordering Keys.
 *
 * 16 statt „so viele wie möglich": Die Zahl muss zum Verbindungs- und
 * Speicherbudget des Workers passen, nicht zur Größe des Rückstands.
 */
export const DEFAULT_MAX_CONCURRENT_KEYS = 16;

/** Entwicklungs-Adapter ohne Cloud: schreibt die Nachrichten ins Log. */
export class LoggingBrokerPublisher implements EventPublisher {
  async publish(events: readonly OutboxEventRecord[]): Promise<void> {
    for (const event of events) {
      console.log(
        `[outbox] ${event.eventType} seq=${event.sequence} eventId=${event.eventId} aggregate=${event.aggregateType}:${event.aggregateId}`,
      );
    }
  }
}

/** Test-Adapter: sammelt alles im Speicher. */
export class InMemoryBrokerPublisher implements EventPublisher {
  readonly published: OutboxEventRecord[] = [];
  async publish(events: readonly OutboxEventRecord[]): Promise<void> {
    this.published.push(...events);
  }
}
