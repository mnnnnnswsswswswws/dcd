import { describe, expect, it, vi } from 'vitest';
import { Cache, Visibility } from './cache.js';
import { createMemoryCacheStore } from './memory-store.js';

describe('Prozesslokaler Store', () => {
  it('liest zurück, was geschrieben wurde', async () => {
    const store = createMemoryCacheStore();
    await store.set('k', 'wert', 1_000);
    expect(await store.get('k')).toBe('wert');
  });

  it('meldet einen unbekannten Schlüssel als null', async () => {
    expect(await createMemoryCacheStore().get('gibt-es-nicht')).toBeNull();
  });

  it('lässt einen Wert nach Ablauf der TTL verschwinden', async () => {
    let jetzt = 1_000;
    const store = createMemoryCacheStore({ now: () => jetzt });
    await store.set('kurz', 'wert', 50);
    jetzt = 1_049;
    expect(await store.get('kurz')).toBe('wert');
    jetzt = 1_050;
    // Exakt bei Ablauf ist der Wert weg, nicht erst danach.
    expect(await store.get('kurz')).toBeNull();
  });

  it('löscht gezielt', async () => {
    const store = createMemoryCacheStore();
    await store.set('weg', 'wert', 1_000);
    await store.del('weg');
    expect(await store.get('weg')).toBeNull();
  });

  it('wächst nicht unbegrenzt, sondern verdrängt die ältesten Einträge', async () => {
    // Der Fall, der ohne Grenze den Container umbringt: viele verschiedene Schlüssel.
    const store = createMemoryCacheStore({ maxEntries: 3 });
    for (const k of ['a', 'b', 'c', 'd']) await store.set(k, k, 60_000);

    expect(await store.get('a')).toBeNull();
    expect(await store.get('d')).toBe('d');
    expect(await store.get('b')).toBe('b');
  });

  it('zählt ein Überschreiben nicht als neuen Eintrag', async () => {
    const store = createMemoryCacheStore({ maxEntries: 2 });
    await store.set('a', '1', 60_000);
    await store.set('b', '1', 60_000);
    await store.set('a', '2', 60_000);
    // Würde das Überschreiben verdrängen, wäre 'b' jetzt weg.
    expect(await store.get('b')).toBe('1');
    expect(await store.get('a')).toBe('2');
  });

  it('trägt den vollständigen Cache-Aside-Pfad', async () => {
    const cache = new Cache({ store: createMemoryCacheStore() });
    const load = vi.fn(async () => ({ id: 'c1', prize: 4200 }));
    const key = { namespace: 'challenge', version: 1, id: 'c1', visibility: Visibility.PUBLIC };

    expect(await cache.getOrLoad({ key, ttlMs: 5_000, load })).toEqual({ id: 'c1', prize: 4200 });
    expect(await cache.getOrLoad({ key, ttlMs: 5_000, load })).toEqual({ id: 'c1', prize: 4200 });
    expect(load).toHaveBeenCalledOnce();
  });

  it('hält private Antworten getrennt', async () => {
    const cache = new Cache({ store: createMemoryCacheStore() });
    const base = { namespace: 'me', version: 1, id: 'wallet', visibility: Visibility.PRIVATE } as const;

    const a = await cache.getOrLoad({ key: { ...base, subjectId: 'u1' }, ttlMs: 5_000, load: async () => 'u1' });
    const b = await cache.getOrLoad({ key: { ...base, subjectId: 'u2' }, ttlMs: 5_000, load: async () => 'u2' });
    expect(a).toBe('u1');
    expect(b).toBe('u2');
  });
});
