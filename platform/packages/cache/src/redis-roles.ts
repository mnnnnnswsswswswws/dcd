/**
 * Trennung von `redis-cache` und `redis-coordination` (Scale S1, Aufgabe 7).
 *
 * Die beiden Rollen haben gegensätzliche Anforderungen und dürfen deshalb weder
 * dieselbe Instanz noch dasselbe Interface teilen:
 *
 *   • **cache** — verlustfrei ersetzbar. Fällt sie aus, wird es langsamer, nicht
 *     falsch. Eviction ist erwünscht, Persistenz unnötig.
 *   • **coordination** — Locks, Rate-Limit-Zähler, Leader-Election. Ein stiller
 *     Verlust hätte hier Wirkung, weshalb Eviction unzulässig ist.
 *
 * Auch die Koordinationsrolle bleibt aber **nicht autoritativ** für Geld, Slots,
 * Votes oder Gewinner (Regel 2): Ein verlorener Lock darf nie zu einer doppelten
 * Auszahlung führen — das verhindert die Datenbank, nicht Redis.
 */

export const RedisRole = {
  CACHE: 'cache',
  COORDINATION: 'coordination',
} as const;
export type RedisRole = (typeof RedisRole)[keyof typeof RedisRole];

export interface RedisRoleConfig {
  readonly role: RedisRole;
  readonly url: string;
  readonly poolSize: number;
  /** Nur für die Cache-Rolle sinnvoll. */
  readonly maxMemoryPolicy?: 'allkeys-lru' | 'volatile-lru' | 'noeviction';
  readonly commandTimeoutMs: number;
}

/**
 * Empfohlene Voreinstellungen je Rolle. `noeviction` für Koordination ist bewusst
 * gesetzt: Lieber ein sichtbarer Fehler als ein still verschwundener Lock.
 */
export const DEFAULT_ROLE_CONFIG: Record<RedisRole, Omit<RedisRoleConfig, 'url'>> = {
  [RedisRole.CACHE]: {
    role: RedisRole.CACHE,
    poolSize: 20,
    maxMemoryPolicy: 'allkeys-lru',
    commandTimeoutMs: 200,
  },
  [RedisRole.COORDINATION]: {
    role: RedisRole.COORDINATION,
    poolSize: 10,
    maxMemoryPolicy: 'noeviction',
    commandTimeoutMs: 1_000,
  },
};

export class InvalidRedisRoleConfigError extends Error {}

/** Verhindert die gefährliche Kombination „Koordination mit Eviction". */
export function validateRoleConfig(config: RedisRoleConfig): void {
  if (config.role === RedisRole.COORDINATION && config.maxMemoryPolicy !== 'noeviction') {
    throw new InvalidRedisRoleConfigError(
      'redis-coordination darf keine Eviction verwenden — Locks und Zähler dürfen nicht still verschwinden.',
    );
  }
  if (config.poolSize <= 0) {
    throw new InvalidRedisRoleConfigError('poolSize muss positiv sein.');
  }
}

/**
 * Koordinationsport. Bewusst schmal und ausdrücklich **beratend**: Ein Lock ist eine
 * Optimierung gegen Doppelarbeit, kein Ersatz für Datenbank-Constraints.
 */
export interface CoordinationClient {
  /** Bester Versuch, einen Lock zu bekommen. `false` = jemand anderes arbeitet. */
  tryAcquire(key: string, ttlMs: number): Promise<boolean>;
  release(key: string): Promise<void>;
  /** Zähler für Rate-Limits; bei Ausfall muss der Aufrufer fail-open/closed entscheiden. */
  increment(key: string, ttlMs: number): Promise<number>;
}
