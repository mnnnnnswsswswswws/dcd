import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Cache, Visibility } from './cache.js';
import { DEFAULT_ROLE_CONFIG, RedisRole } from './redis-roles.js';
import {
  RedisCommandTimeoutError,
  createRedisCacheStore,
  createRedisCacheStoreFromConfig,
  withTimeout,
  type RedisLike,
} from './redis-store.js';

/**
 * Tests gegen ein **echtes** Redis, wenn `REDIS_URL` gesetzt ist — sonst nur die
 * Ausfall- und Timeout-Pfade gegen Test-Doubles.
 *
 * Der Grund für echtes Redis: TTL-Verhalten, Serialisierung und Ausfall lassen sich
 * mit einer Map nicht glaubwürdig nachbilden. Genau dort entstehen die Fehler.
 */
const REDIS_URL = process.env.REDIS_URL;

describe('Kommando-Timeout', () => {
  it('bricht ein hängendes Kommando ab, statt den Request zu blockieren', async () => {
    await expect(
      withTimeout('get', 20, () => new Promise(() => {})),
    ).rejects.toBeInstanceOf(RedisCommandTimeoutError);
  });

  it('lässt ein schnelles Kommando durch', async () => {
    expect(await withTimeout('get', 100, async () => 'ok')).toBe('ok');
  });

  it('räumt den Timer auch im Erfolgsfall ab', async () => {
    // Ohne clearTimeout bliebe der Prozess offen — hier als Vertrag festgehalten.
    const spy = vi.spyOn(globalThis, 'clearTimeout');
    await withTimeout('get', 1000, async () => 'ok');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('Ausfallverhalten mit dem Cache zusammen', () => {
  const brokenClient: RedisLike = {
    async get() {
      throw new Error('ECONNREFUSED');
    },
    async set() {
      throw new Error('ECONNREFUSED');
    },
    async del() {
      throw new Error('ECONNREFUSED');
    },
  };

  it('liefert bei totem Redis weiterhin korrekte Daten', async () => {
    const onStoreError = vi.fn();
    const cache = new Cache({ store: createRedisCacheStore(brokenClient), metrics: { onStoreError } });
    const value = await cache.getOrLoad({
      key: { namespace: 'n', version: 1, id: 'x', visibility: Visibility.PUBLIC },
      ttlMs: 1000,
      load: async () => 'aus-der-datenbank',
    });
    expect(value).toBe('aus-der-datenbank');
    expect(onStoreError).toHaveBeenCalled();
  });

  it('blockiert bei hängendem Redis nicht, sondern degradiert', async () => {
    const hangingClient: RedisLike = {
      get: () => new Promise(() => {}),
      set: () => new Promise(() => {}),
      del: () => new Promise(() => {}),
    };
    const cache = new Cache({
      store: createRedisCacheStore(hangingClient, { commandTimeoutMs: 30 }),
    });
    const started = Date.now();
    const value = await cache.getOrLoad({
      key: { namespace: 'n', version: 1, id: 'y', visibility: Visibility.PUBLIC },
      ttlMs: 1000,
      load: async () => 'direkt',
    });
    expect(value).toBe('direkt');
    // Deutlich unter einem Sekundenbereich: Das Timeout hat gegriffen.
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('Rollenprüfung', () => {
  const client: RedisLike = {
    async get() {
      return null;
    },
    async set() {
      return 'OK';
    },
    async del() {
      return 1;
    },
  };

  it('akzeptiert die Cache-Rolle', () => {
    expect(() =>
      createRedisCacheStoreFromConfig(client, {
        ...DEFAULT_ROLE_CONFIG[RedisRole.CACHE],
        url: 'redis://localhost',
      }),
    ).not.toThrow();
  });

  it('lehnt die Koordinationsinstanz als Cache ab', () => {
    // Andere Garantien (keine Eviction) — Verwechslung wäre ein stiller Fehler.
    expect(() =>
      createRedisCacheStoreFromConfig(client, {
        ...DEFAULT_ROLE_CONFIG[RedisRole.COORDINATION],
        url: 'redis://localhost',
      }),
    ).toThrow(/Rolle "cache"/);
  });
});

/* --------------------- Tests gegen echtes Redis --------------------- */

const maybe = REDIS_URL ? describe : describe.skip;

maybe('Gegen echtes Redis', () => {
  let client: RedisLike & { flushdb(): Promise<unknown>; quit(): Promise<unknown> };

  beforeAll(async () => {
    const { default: Redis } = (await import('ioredis')) as unknown as {
      default: new (url: string) => typeof client;
    };
    client = new Redis(REDIS_URL as string);
  });
  afterAll(async () => {
    await client.quit();
  });
  beforeEach(async () => {
    await client.flushdb();
  });

  it('speichert und liest einen Wert', async () => {
    const store = createRedisCacheStore(client, { keyPrefix: 'test:' });
    await store.set('k1', 'wert', 5_000);
    expect(await store.get('k1')).toBe('wert');
  });

  it('meldet einen unbekannten Schlüssel als null', async () => {
    const store = createRedisCacheStore(client, { keyPrefix: 'test:' });
    expect(await store.get('gibt-es-nicht')).toBeNull();
  });

  it('lässt einen Wert nach Ablauf der TTL verschwinden', async () => {
    const store = createRedisCacheStore(client, { keyPrefix: 'test:' });
    await store.set('kurz', 'wert', 60);
    expect(await store.get('kurz')).toBe('wert');
    await new Promise((r) => setTimeout(r, 120));
    // Genau das lässt sich mit einer Map nicht glaubwürdig nachbilden.
    expect(await store.get('kurz')).toBeNull();
  });

  it('löscht gezielt', async () => {
    const store = createRedisCacheStore(client, { keyPrefix: 'test:' });
    await store.set('weg', 'wert', 5_000);
    await store.del('weg');
    expect(await store.get('weg')).toBeNull();
  });

  it('trennt Schlüssel über das Präfix', async () => {
    const a = createRedisCacheStore(client, { keyPrefix: 'stage-a:' });
    const b = createRedisCacheStore(client, { keyPrefix: 'stage-b:' });
    await a.set('gleich', 'aus-a', 5_000);
    expect(await b.get('gleich')).toBeNull();
    expect(await a.get('gleich')).toBe('aus-a');
  });

  it('trägt den vollständigen Cache-Aside-Pfad', async () => {
    const cache = new Cache({ store: createRedisCacheStore(client, { keyPrefix: 'ca:' }) });
    const load = vi.fn(async () => ({ id: 'c1', prize: 4200 }));
    const key = { namespace: 'challenge', version: 1, id: 'c1', visibility: Visibility.PUBLIC };

    const first = await cache.getOrLoad({ key, ttlMs: 5_000, load });
    const second = await cache.getOrLoad({ key, ttlMs: 5_000, load });

    expect(first).toEqual({ id: 'c1', prize: 4200 });
    expect(second).toEqual(first);
    // Zweiter Aufruf kam aus Redis, nicht aus der Datenbank.
    expect(load).toHaveBeenCalledOnce();
  });

  it('hält private Antworten auch in echtem Redis getrennt', async () => {
    const cache = new Cache({ store: createRedisCacheStore(client, { keyPrefix: 'priv:' }) });
    const base = { namespace: 'me', version: 1, id: 'wallet', visibility: Visibility.PRIVATE } as const;

    const a = await cache.getOrLoad({
      key: { ...base, subjectId: 'u1' }, ttlMs: 5_000, load: async () => 'u1-daten',
    });
    const b = await cache.getOrLoad({
      key: { ...base, subjectId: 'u2' }, ttlMs: 5_000, load: async () => 'u2-daten',
    });
    expect(a).toBe('u1-daten');
    expect(b).toBe('u2-daten');
  });

  it('macht alte Schlüssel durch einen Versions-Bump unerreichbar', async () => {
    const store = createRedisCacheStore(client, { keyPrefix: 'ver:' });
    const cache = new Cache({ store });
    const v1 = { namespace: 'challenge', version: 1, id: 'c9', visibility: Visibility.PUBLIC };
    const v2 = { ...v1, version: 2 };

    await cache.getOrLoad({ key: v1, ttlMs: 5_000, load: async () => 'alt' });
    const nachBump = await cache.getOrLoad({ key: v2, ttlMs: 5_000, load: async () => 'neu' });
    expect(nachBump).toBe('neu');
    // Der alte Eintrag existiert noch, ist aber nicht mehr erreichbar.
    expect(await cache.getOrLoad({ key: v1, ttlMs: 5_000, load: async () => 'x' })).toBe('alt');
  });

  it('bedient 200 gleichzeitige Abrufe mit einem Ladevorgang', async () => {
    const cache = new Cache({ store: createRedisCacheStore(client, { keyPrefix: 'sf:' }) });
    let loads = 0;
    const results = await Promise.all(
      Array.from({ length: 200 }, () =>
        cache.getOrLoad({
          key: { namespace: 'challenge', version: 1, id: 'viral', visibility: Visibility.PUBLIC },
          ttlMs: 5_000,
          load: async () => {
            loads += 1;
            await new Promise((r) => setTimeout(r, 20));
            return 'einmal-geladen';
          },
        }),
      ),
    );
    expect(loads).toBe(1);
    expect(results.every((r) => r === 'einmal-geladen')).toBe(true);
  });
});
