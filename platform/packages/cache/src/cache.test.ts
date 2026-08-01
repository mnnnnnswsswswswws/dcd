import { describe, expect, it, vi } from 'vitest';
import {
  NamespaceVersions,
  PrivateKeyWithoutSubjectError,
  Visibility,
  buildKey,
  isShareable,
} from './keys.js';
import { Cache, jitterTtl, type CacheStore } from './cache.js';
import {
  DEFAULT_ROLE_CONFIG,
  InvalidRedisRoleConfigError,
  RedisRole,
  validateRoleConfig,
} from './redis-roles.js';

/** In-Memory-Store mit optionaler Ausfallsimulation. */
class MemoryStore implements CacheStore {
  map = new Map<string, string>();
  down = false;
  getCalls = 0;
  async get(key: string) {
    this.getCalls += 1;
    if (this.down) throw new Error('redis down');
    return this.map.get(key) ?? null;
  }
  async set(key: string, value: string) {
    if (this.down) throw new Error('redis down');
    this.map.set(key, value);
  }
  async del(key: string) {
    if (this.down) throw new Error('redis down');
    this.map.delete(key);
  }
}

const pubKey = (id = 'c1', version = 1) => ({
  namespace: 'challenge',
  version,
  id,
  visibility: Visibility.PUBLIC,
});

describe('Cache-Schlüssel: Versionierung', () => {
  it('trägt die Namespace-Version im Schlüssel', () => {
    expect(buildKey(pubKey('c1', 3))).toBe('challenge:v3:pub:c1');
  });

  it('macht alte Schlüssel durch einen Versions-Bump unerreichbar', () => {
    const versions = new NamespaceVersions({ challenge: 1 });
    const before = buildKey(pubKey('c1', versions.get('challenge')));
    versions.bump('challenge');
    const after = buildKey(pubKey('c1', versions.get('challenge')));
    expect(after).not.toBe(before);
    expect(after).toContain(':v2:');
  });

  it('sortiert Varianten stabil, damit derselbe Inhalt denselben Schlüssel ergibt', () => {
    const a = buildKey({ ...pubKey(), variant: { lang: 'de', page: 2 } });
    const b = buildKey({ ...pubKey(), variant: { page: 2, lang: 'de' } });
    expect(a).toBe(b);
  });
});

describe('Cache-Schlüssel: private Isolation (Regel 10)', () => {
  it('verweigert einen privaten Schlüssel ohne Subjekt', () => {
    expect(() =>
      buildKey({ namespace: 'me', version: 1, id: 'feed', visibility: Visibility.PRIVATE }),
    ).toThrow(PrivateKeyWithoutSubjectError);
  });

  it('trennt zwei Nutzer strikt', () => {
    const base = { namespace: 'me', version: 1, id: 'feed', visibility: Visibility.PRIVATE } as const;
    const u1 = buildKey({ ...base, subjectId: 'user-1' });
    const u2 = buildKey({ ...base, subjectId: 'user-2' });
    expect(u1).not.toBe(u2);
    expect(u1).toContain('usr:user-1');
  });

  it('kollidiert nie mit einem öffentlichen Schlüssel', () => {
    const priv = buildKey({
      namespace: 'challenge', version: 1, id: 'c1', visibility: Visibility.PRIVATE, subjectId: 'u1',
    });
    expect(priv).not.toBe(buildKey(pubKey('c1')));
  });

  it('erlaubt nur öffentliche Antworten in geteilten Medien', () => {
    expect(isShareable({ visibility: Visibility.PUBLIC })).toBe(true);
    expect(isShareable({ visibility: Visibility.PRIVATE })).toBe(false);
  });

  it('teilt private Werte auch im Cache-Betrieb nicht zwischen Nutzern', async () => {
    const store = new MemoryStore();
    const cache = new Cache({ store });
    const base = { namespace: 'me', version: 1, id: 'wallet', visibility: Visibility.PRIVATE } as const;

    const a = await cache.getOrLoad({
      key: { ...base, subjectId: 'u1' }, ttlMs: 1000, load: async () => 'wert-von-u1',
    });
    const b = await cache.getOrLoad({
      key: { ...base, subjectId: 'u2' }, ttlMs: 1000, load: async () => 'wert-von-u2',
    });
    expect(a).toBe('wert-von-u1');
    expect(b).toBe('wert-von-u2');
  });
});

describe('Cache-Aside', () => {
  it('lädt bei Miss und liefert danach aus dem Cache', async () => {
    const store = new MemoryStore();
    const cache = new Cache({ store, jitterRatio: 0 });
    const load = vi.fn(async () => 'wert');

    expect(await cache.getOrLoad({ key: pubKey(), ttlMs: 1000, load })).toBe('wert');
    expect(await cache.getOrLoad({ key: pubKey(), ttlMs: 1000, load })).toBe('wert');
    expect(load).toHaveBeenCalledOnce();
  });

  it('meldet Hit und Miss an die Metriken', async () => {
    const store = new MemoryStore();
    const onHit = vi.fn();
    const onMiss = vi.fn();
    const cache = new Cache({ store, jitterRatio: 0, metrics: { onHit, onMiss } });
    await cache.getOrLoad({ key: pubKey(), ttlMs: 1000, load: async () => 'v' });
    await cache.getOrLoad({ key: pubKey(), ttlMs: 1000, load: async () => 'v' });
    expect(onMiss).toHaveBeenCalledOnce();
    expect(onHit).toHaveBeenCalledOnce();
  });

  it('invalidiert gezielt', async () => {
    const store = new MemoryStore();
    const cache = new Cache({ store, jitterRatio: 0 });
    const load = vi.fn(async () => 'v');
    await cache.getOrLoad({ key: pubKey(), ttlMs: 1000, load });
    await cache.invalidate(pubKey());
    await cache.getOrLoad({ key: pubKey(), ttlMs: 1000, load });
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('Singleflight', () => {
  it('lädt bei parallelen Misses nur einmal', async () => {
    const store = new MemoryStore();
    const cache = new Cache({ store, jitterRatio: 0 });
    let calls = 0;
    const load = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 10));
      return 'wert';
    };

    const results = await Promise.all(
      Array.from({ length: 50 }, () => cache.getOrLoad({ key: pubKey(), ttlMs: 1000, load })),
    );
    expect(calls).toBe(1);
    expect(results.every((r) => r === 'wert')).toBe(true);
  });

  it('zählt die mitwartenden Aufrufer', async () => {
    const store = new MemoryStore();
    const onSingleflightJoin = vi.fn();
    const cache = new Cache({ store, jitterRatio: 0, metrics: { onSingleflightJoin } });
    const load = async () => {
      await new Promise((r) => setTimeout(r, 5));
      return 'v';
    };
    await Promise.all([
      cache.getOrLoad({ key: pubKey(), ttlMs: 1000, load }),
      cache.getOrLoad({ key: pubKey(), ttlMs: 1000, load }),
      cache.getOrLoad({ key: pubKey(), ttlMs: 1000, load }),
    ]);
    expect(onSingleflightJoin).toHaveBeenCalledTimes(2);
  });

  it('gibt den Slot nach einem Ladefehler wieder frei', async () => {
    const store = new MemoryStore();
    const cache = new Cache({ store, jitterRatio: 0 });
    await expect(
      cache.getOrLoad({ key: pubKey(), ttlMs: 1000, load: async () => { throw new Error('db'); } }),
    ).rejects.toThrow('db');
    // Kein hängender Inflight-Eintrag: der nächste Versuch läuft normal.
    expect(await cache.getOrLoad({ key: pubKey(), ttlMs: 1000, load: async () => 'ok' })).toBe('ok');
  });
});

describe('stale-while-revalidate', () => {
  it('liefert den veralteten Wert sofort und erneuert im Hintergrund', async () => {
    const store = new MemoryStore();
    let t = 1_000;
    const cache = new Cache({ store, jitterRatio: 0, now: () => t });
    let version = 1;
    const load = async () => `v${version}`;

    expect(await cache.getOrLoad({ key: pubKey(), ttlMs: 100, staleWhileRevalidateMs: 1000, load })).toBe('v1');

    version = 2;
    t = 1_150; // frisch abgelaufen, aber innerhalb des SWR-Fensters
    const stale = await cache.getOrLoad({ key: pubKey(), ttlMs: 100, staleWhileRevalidateMs: 1000, load });
    expect(stale).toBe('v1'); // sofort, ohne zu warten

    await new Promise((r) => setTimeout(r, 10)); // Hintergrunderneuerung durchlassen
    t = 1_160;
    expect(await cache.getOrLoad({ key: pubKey(), ttlMs: 100, staleWhileRevalidateMs: 1000, load })).toBe('v2');
  });

  it('lädt nach Ablauf des SWR-Fensters synchron neu', async () => {
    const store = new MemoryStore();
    let t = 1_000;
    const cache = new Cache({ store, jitterRatio: 0, now: () => t });
    await cache.getOrLoad({ key: pubKey(), ttlMs: 100, staleWhileRevalidateMs: 100, load: async () => 'alt' });
    t = 5_000;
    expect(
      await cache.getOrLoad({ key: pubKey(), ttlMs: 100, staleWhileRevalidateMs: 100, load: async () => 'neu' }),
    ).toBe('neu');
  });
});

describe('Negatives Caching', () => {
  it('merkt sich „nicht gefunden" für die kurze negative TTL', async () => {
    const store = new MemoryStore();
    const cache = new Cache({ store, jitterRatio: 0 });
    const load = vi.fn(async () => null);
    expect(await cache.getOrLoad({ key: pubKey('missing'), ttlMs: 1000, negativeTtlMs: 500, load })).toBeNull();
    expect(await cache.getOrLoad({ key: pubKey('missing'), ttlMs: 1000, negativeTtlMs: 500, load })).toBeNull();
    expect(load).toHaveBeenCalledOnce();
  });

  it('cached negativ nur, wenn ausdrücklich gewünscht', async () => {
    const store = new MemoryStore();
    const cache = new Cache({ store, jitterRatio: 0 });
    const load = vi.fn(async () => null);
    await cache.getOrLoad({ key: pubKey('m2'), ttlMs: 1000, load });
    await cache.getOrLoad({ key: pubKey('m2'), ttlMs: 1000, load });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('meldet negative Treffer getrennt', async () => {
    const store = new MemoryStore();
    const onNegativeHit = vi.fn();
    const cache = new Cache({ store, jitterRatio: 0, metrics: { onNegativeHit } });
    const load = async () => null;
    await cache.getOrLoad({ key: pubKey('m3'), ttlMs: 1000, negativeTtlMs: 500, load });
    await cache.getOrLoad({ key: pubKey('m3'), ttlMs: 1000, negativeTtlMs: 500, load });
    expect(onNegativeHit).toHaveBeenCalledOnce();
  });
});

describe('Redis-Ausfall', () => {
  it('liefert weiter korrekt, wenn Redis komplett weg ist', async () => {
    const store = new MemoryStore();
    store.down = true;
    const onStoreError = vi.fn();
    const cache = new Cache({ store, jitterRatio: 0, metrics: { onStoreError } });

    const value = await cache.getOrLoad({ key: pubKey(), ttlMs: 1000, load: async () => 'aus-der-db' });
    expect(value).toBe('aus-der-db');
    expect(onStoreError).toHaveBeenCalled();
  });

  it('erholt sich, sobald Redis zurück ist', async () => {
    const store = new MemoryStore();
    const cache = new Cache({ store, jitterRatio: 0 });
    store.down = true;
    await cache.getOrLoad({ key: pubKey(), ttlMs: 1000, load: async () => 'v' });
    store.down = false;
    const load = vi.fn(async () => 'v');
    await cache.getOrLoad({ key: pubKey(), ttlMs: 1000, load });
    await cache.getOrLoad({ key: pubKey(), ttlMs: 1000, load });
    expect(load).toHaveBeenCalledOnce();
  });

  it('lässt einen Löschfehler den Aufrufer nicht scheitern', async () => {
    const store = new MemoryStore();
    store.down = true;
    const cache = new Cache({ store });
    await expect(cache.invalidate(pubKey())).resolves.toBeUndefined();
  });
});

describe('TTL-Jitter', () => {
  it('streut um den Sollwert', () => {
    expect(jitterTtl(1000, 0.1, () => 0)).toBe(900);
    expect(jitterTtl(1000, 0.1, () => 0.5)).toBe(1000);
    expect(jitterTtl(1000, 0.1, () => 1)).toBe(1100);
  });
  it('lässt sich abschalten', () => {
    expect(jitterTtl(1000, 0, Math.random)).toBe(1000);
  });
  it('bleibt positiv', () => {
    expect(jitterTtl(1, 1, () => 0)).toBeGreaterThan(0);
  });
});

describe('Redis-Rollentrennung', () => {
  it('verbietet Eviction für die Koordinationsrolle', () => {
    expect(() =>
      validateRoleConfig({
        role: RedisRole.COORDINATION,
        url: 'redis://x',
        poolSize: 10,
        maxMemoryPolicy: 'allkeys-lru',
        commandTimeoutMs: 1000,
      }),
    ).toThrow(InvalidRedisRoleConfigError);
  });

  it('akzeptiert die Standardkonfigurationen beider Rollen', () => {
    for (const role of [RedisRole.CACHE, RedisRole.COORDINATION]) {
      expect(() =>
        validateRoleConfig({ ...DEFAULT_ROLE_CONFIG[role], url: 'redis://x' }),
      ).not.toThrow();
    }
  });

  it('setzt für Cache LRU und für Koordination noeviction', () => {
    expect(DEFAULT_ROLE_CONFIG[RedisRole.CACHE].maxMemoryPolicy).toBe('allkeys-lru');
    expect(DEFAULT_ROLE_CONFIG[RedisRole.COORDINATION].maxMemoryPolicy).toBe('noeviction');
  });

  it('lehnt eine unsinnige Pool-Größe ab', () => {
    expect(() =>
      validateRoleConfig({ ...DEFAULT_ROLE_CONFIG[RedisRole.CACHE], url: 'r', poolSize: 0 }),
    ).toThrow(InvalidRedisRoleConfigError);
  });
});
