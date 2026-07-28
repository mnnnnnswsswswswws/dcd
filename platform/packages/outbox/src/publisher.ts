/**
 * Outbox-Publisher (Scale S1, Regel 4 und 5).
 *
 * Ablauf je Durchlauf:
 *   1. fällige Events mit `FOR UPDATE SKIP LOCKED` beanspruchen
 *   2. an den Broker geben
 *   3. als PUBLISHED markieren
 *
 * Der kritische Fall ist Schritt 2→3: Stürzt der Prozess **nach** dem Publish, aber
 * **vor** dem Markieren ab, wird dasselbe Event später erneut zugestellt. Das ist
 * bewusst so — lieber doppelt als verloren. Deshalb gilt durchgängig: at-least-once
 * plus idempotente Consumer. Eine „exactly once"-Zusage gibt dieser Code nicht.
 */

import type {
  EventPublisher,
  OutboxEventRecord,
  OutboxMetrics,
  OutboxStore,
} from './types.js';

export interface PublisherOptions {
  readonly batchSize?: number;
  readonly maxAttempts?: number;
  /** Basis für exponentiellen Backoff in Millisekunden. */
  readonly backoffBaseMs?: number;
  readonly backoffMaxMs?: number;
  readonly metrics?: OutboxMetrics;
  /** Für Tests injizierbar. */
  readonly now?: () => Date;
}

const DEFAULTS = {
  batchSize: 100,
  maxAttempts: 10,
  backoffBaseMs: 1_000,
  backoffMaxMs: 5 * 60_000,
} as const;

export interface PublishRunResult {
  readonly claimed: number;
  readonly published: number;
  readonly failed: number;
  readonly exhausted: number;
}

/**
 * Exponentieller Backoff mit Vollstreuung (Jitter). Ohne Jitter synchronisieren sich
 * mehrere Publisher nach einem Ausfall und schlagen im Gleichtakt erneut zu.
 */
export function backoffDelayMs(
  attempts: number,
  // Explizit `number`, sonst erben die Parameter durch `as const` die Literaltypen
  // aus DEFAULTS und akzeptieren keine anderen Werte.
  baseMs: number = DEFAULTS.backoffBaseMs,
  maxMs: number = DEFAULTS.backoffMaxMs,
  random: () => number = Math.random,
): number {
  const exponential = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempts - 1));
  // Vollständiger Jitter: gleichverteilt in [0, exponential].
  return Math.floor(random() * exponential);
}

export class OutboxPublisher {
  private readonly store: OutboxStore;
  private readonly publisher: EventPublisher;
  private readonly opts: Required<Omit<PublisherOptions, 'metrics' | 'now'>> & {
    metrics?: OutboxMetrics;
    now: () => Date;
  };

  constructor(store: OutboxStore, publisher: EventPublisher, options: PublisherOptions = {}) {
    this.store = store;
    this.publisher = publisher;
    this.opts = {
      batchSize: options.batchSize ?? DEFAULTS.batchSize,
      maxAttempts: options.maxAttempts ?? DEFAULTS.maxAttempts,
      backoffBaseMs: options.backoffBaseMs ?? DEFAULTS.backoffBaseMs,
      backoffMaxMs: options.backoffMaxMs ?? DEFAULTS.backoffMaxMs,
      metrics: options.metrics,
      now: options.now ?? (() => new Date()),
    };
  }

  /** Ein Durchlauf. Der Aufrufer entscheidet über die Schleife bzw. den Trigger. */
  async runOnce(): Promise<PublishRunResult> {
    const now = this.opts.now();
    const batch = await this.store.claimBatch(this.opts.batchSize, now);
    this.opts.metrics?.onClaimed?.(batch.length);

    if (batch.length === 0) {
      return { claimed: 0, published: 0, failed: 0, exhausted: 0 };
    }

    try {
      await this.publisher.publish(batch);
      // Ab hier gilt: veröffentlicht. Ein Absturz vor dem Markieren führt zu einer
      // erneuten Zustellung — abgefangen durch die idempotenten Consumer.
      await this.store.markPublished(
        batch.map((e) => e.sequence),
        this.opts.now(),
      );
      this.opts.metrics?.onPublished?.(batch.length);
      return { claimed: batch.length, published: batch.length, failed: 0, exhausted: 0 };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      let failed = 0;
      let exhausted = 0;
      for (const event of batch) {
        // `claimBatch` hat `attempts` bereits erhöht — hier NICHT erneut addieren.
        const attempts = event.attempts;
        const giveUp = attempts >= this.opts.maxAttempts;
        const retryAt = giveUp
          ? null
          : new Date(
              this.opts.now().getTime() +
                backoffDelayMs(attempts, this.opts.backoffBaseMs, this.opts.backoffMaxMs),
            );
        await this.store.markFailed(event.sequence, message, retryAt, this.opts.now());
        this.opts.metrics?.onFailed?.(event.sequence, attempts, message);
        if (giveUp) {
          this.opts.metrics?.onExhausted?.(event.sequence);
          exhausted += 1;
        }
        failed += 1;
      }
      return { claimed: batch.length, published: 0, failed, exhausted };
    }
  }

  /** Läuft, bis nichts mehr fällig ist oder `maxRuns` erreicht wurde. */
  async drain(maxRuns = 100): Promise<PublishRunResult> {
    const total = { claimed: 0, published: 0, failed: 0, exhausted: 0 };
    for (let i = 0; i < maxRuns; i += 1) {
      const r = await this.runOnce();
      total.claimed += r.claimed;
      total.published += r.published;
      total.failed += r.failed;
      total.exhausted += r.exhausted;
      if (r.claimed === 0) break;
    }
    return total;
  }
}

/** Lag-Kennzahl für Dashboards: Alter des ältesten unveröffentlichten Events. */
export function outboxLagMs(oldestPending: OutboxEventRecord | undefined, now: Date): number {
  if (!oldestPending) return 0;
  return Math.max(0, now.getTime() - oldestPending.createdAt.getTime());
}
