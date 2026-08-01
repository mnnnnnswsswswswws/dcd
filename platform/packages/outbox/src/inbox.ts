/**
 * Consumer-Inbox und idempotente Handler-Basis (Scale S1, Regel 5).
 *
 * Weil die Outbox at-least-once zustellt, ist Mehrfachzustellung der Normalfall.
 * Die Inbox macht daraus einen **effektiv einmaligen** Effekt, ohne „exactly once"
 * zu behaupten: Jeder Handler markiert `(messageId, handlerName)` als verarbeitet;
 * der Unique-Index in PostgreSQL entscheidet das Rennen, nicht Anwendungscode.
 *
 * Wichtig für Reihenfolge: Pub/Sub liefert nicht sortiert. Handler müssen deshalb
 * out-of-order verkraften — dafür gibt es `isStale`, das veraltete Nachrichten
 * anhand einer monotonen Sequenz verwirft, statt neueren Zustand zu überschreiben.
 */

export interface InboundMessage {
  readonly messageId: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: Readonly<Record<string, unknown>>;
  /** Monotone Sequenz aus der Outbox — Grundlage der Out-of-order-Erkennung. */
  readonly sequence?: bigint;
}

export interface InboxStore {
  /**
   * Versucht, die Nachricht für diesen Handler zu beanspruchen.
   * Rückgabe `false` = bereits verarbeitet (Duplikat).
   *
   * Muss auf dem Unique-Constraint `(message_id, handler_name)` beruhen, damit auch
   * zwei gleichzeitig laufende Consumer-Instanzen sauber entschieden werden.
   */
  tryMarkProcessed(
    messageId: string,
    handlerName: string,
    result?: Readonly<Record<string, unknown>>,
  ): Promise<boolean>;
}

/** Optionaler Port für Handler, die Out-of-order-Nachrichten erkennen wollen. */
export interface SequenceTracker {
  /** Zuletzt angewandte Sequenz für dieses Aggregat. */
  lastApplied(aggregateType: string, aggregateId: string): Promise<bigint | undefined>;
  record(aggregateType: string, aggregateId: string, sequence: bigint): Promise<void>;
}

export const HandlerOutcome = {
  PROCESSED: 'PROCESSED',
  DUPLICATE_SKIPPED: 'DUPLICATE_SKIPPED',
  STALE_SKIPPED: 'STALE_SKIPPED',
  FAILED: 'FAILED',
} as const;
export type HandlerOutcome = (typeof HandlerOutcome)[keyof typeof HandlerOutcome];

export interface HandlerResult {
  readonly outcome: HandlerOutcome;
  readonly error?: string;
}

export interface IdempotentHandlerOptions {
  readonly name: string;
  readonly store: InboxStore;
  /** Nur setzen, wenn die Reihenfolge für diesen Handler fachlich zählt. */
  readonly sequenceTracker?: SequenceTracker;
  readonly metrics?: {
    onProcessed?(name: string): void;
    onDuplicate?(name: string): void;
    onStale?(name: string): void;
    onFailed?(name: string, error: string): void;
  };
}

/**
 * Wiederverwendbare Basis für idempotente Consumer.
 *
 * Reihenfolge der Prüfungen ist bewusst gewählt:
 *   1. Duplikat? → nichts tun (billigste und häufigste Abweisung)
 *   2. veraltet? → nichts tun, aber als verarbeitet markieren
 *   3. Effekt ausführen
 *
 * Der Effekt läuft **nach** der Beanspruchung. Schlägt er fehl, wird die Markierung
 * zurückgenommen, damit ein Retry ihn erneut ausführen darf — sonst würde ein
 * einmaliger Fehler die Nachricht dauerhaft verschlucken.
 */
export class IdempotentHandler<T = void> {
  private readonly opts: IdempotentHandlerOptions;
  private readonly effect: (message: InboundMessage) => Promise<T>;
  private readonly release?: (messageId: string, handlerName: string) => Promise<void>;

  constructor(
    options: IdempotentHandlerOptions,
    effect: (message: InboundMessage) => Promise<T>,
    /** Optionales Zurücknehmen der Markierung bei Fehlschlag des Effekts. */
    release?: (messageId: string, handlerName: string) => Promise<void>,
  ) {
    this.opts = options;
    this.effect = effect;
    this.release = release;
  }

  async handle(message: InboundMessage): Promise<HandlerResult> {
    const claimed = await this.opts.store.tryMarkProcessed(message.messageId, this.opts.name);
    if (!claimed) {
      this.opts.metrics?.onDuplicate?.(this.opts.name);
      return { outcome: HandlerOutcome.DUPLICATE_SKIPPED };
    }

    if (this.opts.sequenceTracker && message.sequence !== undefined) {
      const last = await this.opts.sequenceTracker.lastApplied(
        message.aggregateType,
        message.aggregateId,
      );
      if (last !== undefined && message.sequence <= last) {
        // Veraltete Nachricht: Sie würde neueren Zustand überschreiben. Wir lassen
        // die Verarbeitungs-Markierung bewusst stehen, damit sie nicht wiederkehrt.
        this.opts.metrics?.onStale?.(this.opts.name);
        return { outcome: HandlerOutcome.STALE_SKIPPED };
      }
    }

    try {
      await this.effect(message);
      if (this.opts.sequenceTracker && message.sequence !== undefined) {
        await this.opts.sequenceTracker.record(
          message.aggregateType,
          message.aggregateId,
          message.sequence,
        );
      }
      this.opts.metrics?.onProcessed?.(this.opts.name);
      return { outcome: HandlerOutcome.PROCESSED };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      // Markierung zurücknehmen, damit der Retry den Effekt erneut ausführen darf.
      await this.release?.(message.messageId, this.opts.name);
      this.opts.metrics?.onFailed?.(this.opts.name, error);
      return { outcome: HandlerOutcome.FAILED, error };
    }
  }
}

/** Prisma-Implementierung der Inbox über den Unique-Index (message_id, handler_name). */
export interface PrismaInboxClient {
  processedMessage: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }>;
  };
}

export function createPrismaInboxStore(prisma: PrismaInboxClient): InboxStore & {
  release(messageId: string, handlerName: string): Promise<void>;
} {
  return {
    async tryMarkProcessed(messageId, handlerName, result) {
      try {
        await prisma.processedMessage.create({
          data: {
            messageId,
            handlerName,
            ...(result ? { resultJson: result as Record<string, unknown> } : {}),
          },
        });
        return true;
      } catch (err) {
        // Unique-Verletzung = bereits verarbeitet. Alles andere weiterreichen,
        // damit echte Fehler nicht als Duplikat getarnt werden.
        if (isUniqueViolation(err)) return false;
        throw err;
      }
    },
    async release(messageId, handlerName) {
      await prisma.processedMessage.deleteMany({ where: { messageId, handlerName } });
    },
  };
}

/** Prisma meldet Unique-Verletzungen als P2002. */
export function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return code === 'P2002' || code === '23505';
}
