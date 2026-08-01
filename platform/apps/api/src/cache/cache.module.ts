/**
 * Cache-Verdrahtung der laufenden API.
 *
 * Bis hierher war `@vcp/cache` gebaut und getestet, aber im Betrieb nie erreichbar:
 * Kein Codepfad hat je einen Redis-Client erzeugt, und `REDIS_URL` wurde außerhalb
 * der Tests nicht gelesen. Ein Cache, den niemand instanziiert, entlastet nichts —
 * und ein Verbindungsbudget für Verbindungen, die nie geöffnet werden, beschreibt
 * eine Infrastruktur, die es nicht gibt.
 *
 * Auswahl des Stores:
 *
 *   • `REDIS_URL` gesetzt  → Redis, Rolle `cache` (geprüft in packages/cache).
 *   • sonst                → prozesslokal.
 *
 * Der Fallback ist kein Notbehelf für Produktion, sondern hält den Codepfad in
 * Entwicklung und CI identisch. Fällt Redis zur Laufzeit aus, greift zusätzlich das
 * Fail-Open in `Cache`: langsamer, nicht falsch.
 */

import { Global, Logger, Module } from '@nestjs/common';
import {
  DEFAULT_ROLE_CONFIG,
  RedisRole,
  createMemoryCacheStore,
  createRedisCacheStoreFromConfig,
  type CacheStore,
  type RedisLike,
} from '@vcp/cache';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChallengeDetailCache } from '../challenges/challenge-detail-cache.js';
import { ChallengeListCache } from '../challenges/challenge-list-cache.js';

export const CACHE_STORE = Symbol('CACHE_STORE');

/**
 * Baut den Store. `ioredis` wird über einen Variablen-Spezifizierer geladen, damit
 * die Abhängigkeit optional bleibt: Ein Dienst ohne `REDIS_URL` soll nicht daran
 * scheitern, dass ein Redis-Client nicht installiert ist.
 */
export async function createCacheStore(
  logger: Pick<Logger, 'log' | 'warn'> = new Logger('Cache'),
  env: NodeJS.ProcessEnv = process.env,
): Promise<CacheStore> {
  const url = env.REDIS_URL;
  if (url === undefined || url.length === 0) {
    logger.warn('REDIS_URL nicht gesetzt — prozesslokaler Cache. Für Produktion ist Redis erforderlich.');
    return createMemoryCacheStore();
  }

  // Schema vorab prüfen: ioredis meldet eine unbrauchbare URL erst asynchron über
  // ein 'error'-Ereignis. Ohne diese Prüfung liefe der Dienst mit einem Client, der
  // nie verbindet — jeder Zugriff liefe in den Timeout und der Cache wäre still
  // wirkungslos statt sichtbar abwesend.
  if (!/^rediss?:\/\//.test(url)) {
    logger.warn(`REDIS_URL hat kein redis://- oder rediss://-Schema — prozesslokaler Cache.`);
    return createMemoryCacheStore();
  }

  try {
    const specifier = 'ioredis';
    const mod = (await import(specifier)) as unknown as {
      default: new (url: string, options: Record<string, unknown>) => RedisLike;
    };
    const client = new mod.default(url, {
      // Die Warteschlange bleibt an. Sie ist ungefährlich, weil **jedes** Kommando
      // ohnehin unter einem harten Timeout steht (packages/cache/src/redis-store.ts):
      // Ein eingereihtes Kommando wird spätestens dort freigegeben. Ohne Queue wäre
      // der Cache dagegen in genau den Sekunden nach dem Start tot, in denen ein
      // frisch hochskalierter Container die meiste Last abbekommt.
      enableOfflineQueue: true,
      maxRetriesPerRequest: 1,
      lazyConnect: false,
    });
    // Ein Verbindungsfehler darf keinen unbehandelten Ereignisfehler auslösen —
    // der würde den Prozess beenden, obwohl der Cache verzichtbar ist.
    (client as unknown as { on?: (e: string, h: (err: Error) => void) => void }).on?.(
      'error',
      (err: Error) => logger.warn(`Redis-Verbindungsfehler: ${err.message}`),
    );
    logger.log('Redis-Cache aktiv.');
    return createRedisCacheStoreFromConfig(client, {
      ...DEFAULT_ROLE_CONFIG[RedisRole.CACHE],
      url,
    });
  } catch (error) {
    // Ein fehlender oder kaputter Client darf den Start nicht verhindern: Der Cache
    // ist nie autoritativ, sein Ausfall macht den Dienst langsamer, nicht falsch.
    logger.warn(
      `Redis-Cache nicht verfügbar (${error instanceof Error ? error.message : String(error)}) — prozesslokaler Cache.`,
    );
    return createMemoryCacheStore();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: CACHE_STORE,
      useFactory: () => createCacheStore(),
    },
    {
      provide: ChallengeDetailCache,
      inject: [PrismaService, CACHE_STORE],
      useFactory: (prisma: PrismaService, store: CacheStore) =>
        new ChallengeDetailCache({ prisma, store }),
    },
    {
      provide: ChallengeListCache,
      inject: [PrismaService, CACHE_STORE],
      useFactory: (prisma: PrismaService, store: CacheStore) =>
        new ChallengeListCache({ prisma, store }),
    },
  ],
  exports: [CACHE_STORE, ChallengeDetailCache, ChallengeListCache],
})
export class CacheModule {}
