/**
 * Prozesslokaler Cache-Store.
 *
 * Zweck ist **nicht**, Redis nachzubilden. Der Store existiert, damit Entwicklung,
 * Tests und ein Cloud-Run-Dienst ohne `REDIS_URL` denselben Codepfad durchlaufen wie
 * die Produktion — statt den Cache dort ersatzlos zu überspringen. Ein übersprungener
 * Cache heißt: Der Pfad, der später unter Last läuft, wird nie ausgeführt.
 *
 * Bewusste Grenzen, die ihn für Produktion disqualifizieren:
 *
 *   • Jede Instanz hat ihren eigenen Inhalt. Bei n Instanzen entstehen n Kopien und
 *     n Ladevorgänge — die Entlastung der Datenbank skaliert nicht.
 *   • Kein gemeinsamer Invalidierungspunkt: Ein Versions-Bump wirkt nur dort, wo er
 *     ausgeführt wird.
 *
 * Beides ist unkritisch, weil der Cache ohnehin nie autoritativ ist (Regel 2) — aber
 * es ist der Grund, warum in Produktion `REDIS_URL` gesetzt sein muss.
 */

import type { CacheStore } from './cache.js';

interface Entry {
  readonly value: string;
  readonly expiresAt: number;
}

export interface MemoryStoreOptions {
  /**
   * Obergrenze für Einträge. Ohne Grenze wächst der Store bis zum Speicherlimit des
   * Containers — bei einem Cache-Miss-Sturm mit vielen unterschiedlichen Schlüsseln
   * genau dann, wenn ohnehin nichts mehr funktioniert.
   */
  readonly maxEntries?: number;
  readonly now?: () => number;
}

export function createMemoryCacheStore(options: MemoryStoreOptions = {}): CacheStore {
  const maxEntries = options.maxEntries ?? 10_000;
  const now = options.now ?? (() => Date.now());
  // Map bewahrt die Einfügereihenfolge — damit ist der älteste Eintrag der erste.
  const entries = new Map<string, Entry>();

  return {
    async get(key: string): Promise<string | null> {
      const entry = entries.get(key);
      if (entry === undefined) return null;
      if (entry.expiresAt <= now()) {
        // Abgelaufene Einträge werden beim Lesen entfernt, nicht per Timer: Ein
        // Timer je Schlüssel hielte den Prozess offen und kostet mehr als er spart.
        entries.delete(key);
        return null;
      }
      return entry.value;
    },

    async set(key: string, value: string, ttlMs: number): Promise<void> {
      // Vor dem Einfügen verdrängen, damit maxEntries auch nach dem Schreiben gilt.
      if (!entries.has(key)) {
        while (entries.size >= maxEntries) {
          const oldest = entries.keys().next();
          if (oldest.done === true) break;
          entries.delete(oldest.value);
        }
      }
      entries.set(key, { value, expiresAt: now() + Math.max(1, ttlMs) });
    },

    async del(key: string): Promise<void> {
      entries.delete(key);
    },
  };
}
