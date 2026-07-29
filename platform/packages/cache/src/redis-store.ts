/**
 * Redis-Implementierung des Cache-Ports (Scale S1).
 *
 * Der Cache ist nie autoritativ (Architekturregel 2). Deshalb ist die wichtigste
 * Eigenschaft dieses Adapters nicht Geschwindigkeit, sondern **Ausfallverhalten**:
 *
 *   • Jedes Kommando hat ein hartes Timeout. Ohne das hilft der Fail-Open-Pfad in
 *     `Cache` nichts — ein hängendes Redis würde den Request blockieren statt ihn
 *     langsamer, aber korrekt zu bedienen.
 *   • Verbindungsfehler werden nicht verschluckt, sondern als Fehler nach oben
 *     gereicht; `Cache` behandelt sie als Miss und meldet sie an die Metriken.
 *   • Es wird **nicht** unbegrenzt wiederholt: Ein Cache-Read, der dreimal scheitert,
 *     ist teurer als ein Direktzugriff auf die Datenbank.
 *
 * Der Client wird über einen schmalen Port injiziert, damit dieses Paket keine harte
 * Abhängigkeit auf eine bestimmte Bibliothek trägt und ohne Redis testbar bleibt.
 */

import type { CacheStore } from './cache.js';
import { RedisRole, validateRoleConfig, type RedisRoleConfig } from './redis-roles.js';

/** Nur die vier Kommandos, die der Cache wirklich braucht. */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'PX', ttlMs: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
  quit?(): Promise<unknown>;
}

export class RedisCommandTimeoutError extends Error {
  constructor(operation: string, timeoutMs: number) {
    super(`Redis-Kommando "${operation}" nach ${timeoutMs} ms abgebrochen.`);
    this.name = 'RedisCommandTimeoutError';
  }
}

/**
 * Bricht ein Kommando nach `timeoutMs` ab.
 *
 * Bewusst mit eigenem Timer statt auf Client-Optionen zu vertrauen: Ein Client kann
 * beim Verbindungsaufbau hängen, bevor seine eigenen Timeouts greifen.
 */
export async function withTimeout<T>(
  operation: string,
  timeoutMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new RedisCommandTimeoutError(operation, timeoutMs)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export interface RedisStoreOptions {
  /** Kommando-Timeout; Default aus der Rollenkonfiguration. */
  readonly commandTimeoutMs?: number;
  /** Präfix zur Trennung von Umgebungen auf geteilter Infrastruktur. */
  readonly keyPrefix?: string;
}

/**
 * Baut einen `CacheStore` auf einem Redis-Client.
 *
 * TTLs werden in Millisekunden gesetzt (`PX`), damit die vom `Cache` berechnete
 * Streuung nicht durch Sekundenrundung verloren geht.
 */
export function createRedisCacheStore(
  client: RedisLike,
  options: RedisStoreOptions = {},
): CacheStore {
  const timeout = options.commandTimeoutMs ?? 200;
  const prefix = options.keyPrefix ?? '';
  const k = (key: string): string => `${prefix}${key}`;

  return {
    async get(key: string): Promise<string | null> {
      return withTimeout('get', timeout, () => client.get(k(key)));
    },
    async set(key: string, value: string, ttlMs: number): Promise<void> {
      // Mindestens 1 ms — Redis lehnt 0 oder negative TTLs ab.
      const px = Math.max(1, Math.floor(ttlMs));
      await withTimeout('set', timeout, () => client.set(k(key), value, 'PX', px));
    },
    async del(key: string): Promise<void> {
      await withTimeout('del', timeout, () => client.del(k(key)));
    },
  };
}

/**
 * Erzeugt einen Store aus einer geprüften Rollenkonfiguration.
 *
 * Nur die Cache-Rolle ist zulässig: Die Koordinationsrolle hat andere Garantien
 * (keine Eviction) und darf nicht versehentlich als Cache verwendet werden.
 */
export function createRedisCacheStoreFromConfig(
  client: RedisLike,
  config: RedisRoleConfig,
  options: RedisStoreOptions = {},
): CacheStore {
  validateRoleConfig(config);
  if (config.role !== RedisRole.CACHE) {
    throw new Error(
      'Für den Cache darf nur die Rolle "cache" verwendet werden; die Koordinationsinstanz hat andere Garantien.',
    );
  }
  return createRedisCacheStore(client, {
    commandTimeoutMs: options.commandTimeoutMs ?? config.commandTimeoutMs,
    keyPrefix: options.keyPrefix,
  });
}
