/**
 * Cache-Aside mit Singleflight, TTL-Jitter, stale-while-revalidate und negativem
 * Caching (Scale S1, Regeln 2 und 8).
 *
 * Leitplanke, die den ganzen Aufbau prägt: **Der Cache ist nie autoritativ.** Fällt
 * Redis aus, muss der Pfad weiterlaufen — langsamer, aber korrekt. Jeder Store-Fehler
 * wird deshalb geschluckt und als Miss behandelt, statt den Request scheitern zu
 * lassen. Kritische Entscheidungen (Slot, Vote, Gewinner, Geld) lesen ohnehin
 * ausschließlich primär aus PostgreSQL und benutzen diese Klasse nicht.
 */

import { Visibility, buildKey, type KeySpec } from './keys.js';

export interface CacheEntry<T> {
  readonly value: T;
  /** Ab hier gilt der Wert als veraltet, ist aber noch ausgebbar (SWR). */
  readonly staleAt: number;
  /** Ab hier wird der Wert verworfen. */
  readonly expiresAt: number;
  /** Negativer Eintrag: „existiert nicht" wurde bewusst gecacht. */
  readonly negative?: boolean;
}

/** Schmaler Store-Port — Redis, In-Memory oder Test-Double. */
export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
  del(key: string): Promise<void>;
}

export interface CacheMetrics {
  onHit?(namespace: string): void;
  onMiss?(namespace: string): void;
  onStaleHit?(namespace: string): void;
  onNegativeHit?(namespace: string): void;
  onStoreError?(namespace: string, operation: string, error: string): void;
  onSingleflightJoin?(namespace: string): void;
  onRevalidate?(namespace: string): void;
}

export interface CacheOptions {
  readonly store: CacheStore;
  readonly metrics?: CacheMetrics;
  /** Anteil zufälliger TTL-Streuung, 0..1. Default 0.1 = ±10 %. */
  readonly jitterRatio?: number;
  readonly now?: () => number;
  readonly random?: () => number;
}

export interface GetOptions<T> {
  readonly key: KeySpec;
  readonly ttlMs: number;
  /** Zeitfenster, in dem ein veralteter Wert noch ausgeliefert werden darf. */
  readonly staleWhileRevalidateMs?: number;
  /** TTL für „nicht gefunden". Kurz halten — sonst bleibt Neues zu lange unsichtbar. */
  readonly negativeTtlMs?: number;
  readonly load: () => Promise<T | null>;
}

/**
 * Streut die TTL, damit nicht tausende gleichzeitig geschriebene Einträge auch
 * gleichzeitig ablaufen und in einem Schlag auf die Datenbank durchschlagen
 * (Cache-Stampede nach Deploy oder viralem Peak).
 */
export function jitterTtl(ttlMs: number, ratio: number, random: () => number): number {
  if (ratio <= 0) return ttlMs;
  const delta = ttlMs * ratio;
  return Math.max(1, Math.round(ttlMs - delta + random() * 2 * delta));
}

export class Cache {
  private readonly store: CacheStore;
  private readonly metrics?: CacheMetrics;
  private readonly jitterRatio: number;
  private readonly now: () => number;
  private readonly random: () => number;
  /** Laufende Ladevorgänge je Schlüssel — das ist der Singleflight. */
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(options: CacheOptions) {
    this.store = options.store;
    this.metrics = options.metrics;
    this.jitterRatio = options.jitterRatio ?? 0.1;
    this.now = options.now ?? (() => Date.now());
    this.random = options.random ?? Math.random;
  }

  /**
   * Cache-Aside mit allen Schutzmechanismen.
   *
   * Ablauf: frischer Treffer → sofort; veralteter Treffer → sofort ausliefern und im
   * Hintergrund erneuern; Miss → genau **ein** Ladevorgang je Schlüssel, alle anderen
   * warten mit (Singleflight).
   */
  async getOrLoad<T>(opts: GetOptions<T>): Promise<T | null> {
    const ns = opts.key.namespace;
    const key = buildKey(opts.key);

    const cached = await this.readEntry<T>(key, ns);
    const now = this.now();

    if (cached) {
      if (cached.negative) {
        this.metrics?.onNegativeHit?.(ns);
        return null;
      }
      if (now < cached.staleAt) {
        this.metrics?.onHit?.(ns);
        return cached.value;
      }
      if (now < cached.expiresAt) {
        // stale-while-revalidate: alten Wert sofort ausliefern, Erneuerung anstoßen.
        this.metrics?.onStaleHit?.(ns);
        void this.revalidate(key, ns, opts);
        return cached.value;
      }
    }

    this.metrics?.onMiss?.(ns);
    return this.loadSingleflight(key, ns, opts);
  }

  /** Genau ein Ladevorgang je Schlüssel; parallele Aufrufer hängen sich an. */
  private async loadSingleflight<T>(
    key: string,
    ns: string,
    opts: GetOptions<T>,
  ): Promise<T | null> {
    const existing = this.inflight.get(key);
    if (existing) {
      this.metrics?.onSingleflightJoin?.(ns);
      return existing as Promise<T | null>;
    }

    const promise = (async (): Promise<T | null> => {
      try {
        const value = await opts.load();
        await this.writeEntry(key, ns, value, opts);
        return value;
      } finally {
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, promise);
    return promise;
  }

  private async revalidate<T>(key: string, ns: string, opts: GetOptions<T>): Promise<void> {
    if (this.inflight.has(key)) return;
    this.metrics?.onRevalidate?.(ns);
    try {
      await this.loadSingleflight(key, ns, opts);
    } catch {
      // Hintergrunderneuerung darf den laufenden Request nie beeinflussen.
    }
  }

  private async readEntry<T>(key: string, ns: string): Promise<CacheEntry<T> | null> {
    try {
      const raw = await this.store.get(key);
      if (raw === null) return null;
      return JSON.parse(raw) as CacheEntry<T>;
    } catch (err) {
      // Redis weg oder Eintrag unlesbar → als Miss behandeln, nicht scheitern.
      this.metrics?.onStoreError?.(ns, 'get', err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  private async writeEntry<T>(
    key: string,
    ns: string,
    value: T | null,
    opts: GetOptions<T>,
  ): Promise<void> {
    const now = this.now();
    const isNegative = value === null;
    const baseTtl = isNegative ? (opts.negativeTtlMs ?? 0) : opts.ttlMs;
    if (baseTtl <= 0) return; // negatives Caching nicht gewünscht

    const ttl = jitterTtl(baseTtl, this.jitterRatio, this.random);
    const swr = isNegative ? 0 : (opts.staleWhileRevalidateMs ?? 0);
    const entry: CacheEntry<T | null> = {
      value,
      staleAt: now + ttl,
      expiresAt: now + ttl + swr,
      ...(isNegative ? { negative: true } : {}),
    };
    try {
      await this.store.set(key, JSON.stringify(entry), ttl + swr);
    } catch (err) {
      // Schreibfehler sind ebenfalls unkritisch — der Wert wurde bereits geladen.
      this.metrics?.onStoreError?.(ns, 'set', err instanceof Error ? err.message : String(err));
    }
  }

  /** Gezieltes Löschen. Für flächige Invalidierung stattdessen Namespace-Bump nutzen. */
  async invalidate(key: KeySpec): Promise<void> {
    try {
      await this.store.del(buildKey(key));
    } catch (err) {
      this.metrics?.onStoreError?.(
        key.namespace,
        'del',
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}

export { Visibility };
