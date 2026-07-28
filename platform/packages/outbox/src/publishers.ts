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
 * Publisher gegen einen echten Broker. Bewusst sequenziell je Nachricht: Bei einem
 * Fehler mittendrin schlägt der ganze Batch fehl und wird erneut zugestellt — das ist
 * korrekt, weil die Consumer idempotent sind, und einfacher als partielle Buchführung.
 */
export function createBrokerPublisher(topic: TopicClient): EventPublisher {
  return {
    async publish(events: readonly OutboxEventRecord[]): Promise<void> {
      for (const event of events) {
        await topic.publishMessage(toBrokerMessage(event));
      }
    },
  };
}

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
