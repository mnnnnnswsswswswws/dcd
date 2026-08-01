/**
 * Minimaler Event-Publisher-Kontrakt. Produktiv steht hier Pub/Sub; für Tests und
 * die aktuelle Phase genügt eine Logging-Implementierung. Events werden erst nach
 * erfolgreichem Commit veröffentlicht (nie innerhalb der Transaktion).
 */

export interface DomainEvent {
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly occurredAt: Date;
}

export interface EventPublisher {
  publish(event: DomainEvent): Promise<void>;
}

export class LoggingEventPublisher implements EventPublisher {
  async publish(event: DomainEvent): Promise<void> {
     
    console.log(`[event] ${event.type}`, JSON.stringify(event.payload));
  }
}

/** Sammelt Events im Speicher — nützlich für Tests. */
export class InMemoryEventPublisher implements EventPublisher {
  readonly events: DomainEvent[] = [];

  async publish(event: DomainEvent): Promise<void> {
    this.events.push(event);
  }
}
