import { PrismaClient } from '@prisma/client';
import { loadEnv } from '@vcp/config';
import { createPooledPrismaClient } from '@vcp/api';
import {
  LoggingBrokerPublisher,
  OutboxPublisher,
  createBrokerPublisher,
  createPrismaOutboxStore,
  outboxLagMs,
  type EventPublisher,
  type TopicClient,
} from '@vcp/outbox';

/**
 * Outbox-Publisher-Worker.
 *
 * Liest fällige Einträge aus `outbox_events` (FOR UPDATE SKIP LOCKED), stellt sie an
 * den Broker zu und markiert sie. Mehrere Instanzen dürfen parallel laufen — genau
 * dafür ist SKIP LOCKED da.
 *
 * Ohne konfiguriertes Pub/Sub-Topic läuft der Worker mit dem Logging-Adapter. Das ist
 * Absicht: In Entwicklung und CI soll er ohne Cloud-Credentials arbeiten, statt beim
 * Start zu scheitern. Der Wechsel auf den echten Broker ist eine Konfigurationsfrage,
 * keine Codeänderung.
 */

const DEFAULT_INTERVAL_MS = 1_000;
const BATCH_SIZE = 100;

/**
 * Baut den Broker-Adapter. Ist `PUBSUB_TOPIC` gesetzt, wird der echte Client
 * dynamisch geladen — so bleibt `@google-cloud/pubsub` eine optionale Abhängigkeit,
 * die lokale Läufe nicht braucht.
 */
async function createPublisher(): Promise<EventPublisher> {
  const topicName = process.env.PUBSUB_TOPIC;
  if (!topicName) {
    console.log('[outbox] PUBSUB_TOPIC nicht gesetzt — Logging-Adapter aktiv (keine Zustellung).');
    return new LoggingBrokerPublisher();
  }
  try {
    // Spezifizierer bewusst als Variable: So versucht TypeScript nicht, das Modul
    // statisch aufzulösen. Das Paket ist eine **deklarierte** Abhängigkeit dieses
    // Workers — ohne sie bräche der Start in Cloud Run, weil Terraform PUBSUB_TOPIC
    // dort immer setzt. Geladen wird sie trotzdem nur bei Bedarf: Lokal und in CI
    // läuft der Worker ohne Topic über den Logging-Adapter und fasst sie nie an.
    const specifier = '@google-cloud/pubsub';
    const mod = (await import(specifier)) as unknown as {
      PubSub: new () => { topic(name: string, opts?: unknown): TopicClient };
    };
    const pubsub = new mod.PubSub();
    // messageOrdering ist nötig, damit der OrderingKey überhaupt greift.
    const topic = pubsub.topic(topicName, { messageOrdering: true });
    console.log(`[outbox] Pub/Sub-Adapter aktiv, Topic=${topicName}`);
    return createBrokerPublisher(topic);
  } catch (err) {
    // Fail-closed: Lieber sichtbar abbrechen als still nichts zustellen, wenn ein
    // Topic konfiguriert wurde.
    throw new Error(
      `[outbox] PUBSUB_TOPIC="${topicName}" gesetzt, aber Pub/Sub-Client nicht ladbar: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

async function main(): Promise<void> {
  loadEnv();
  // Poolgroesse aus DB_POOL_SIZE (Terraform) statt Prisma-Default —
  // sonst gilt das im CI geprüfte Verbindungsbudget für Worker nicht.
  const prisma = createPooledPrismaClient(PrismaClient);
  const store = createPrismaOutboxStore(prisma);
  const publisher = await createPublisher();

  const outbox = new OutboxPublisher(store, publisher, {
    batchSize: BATCH_SIZE,
    metrics: {
      onPublished(count) {
        if (count > 0) console.log(`[outbox] zugestellt=${count}`);
      },
      onFailed(sequence, attempts, error) {
        console.warn(`[outbox] Fehlschlag seq=${sequence} versuch=${attempts}: ${error}`);
      },
      onExhausted(sequence) {
        // Endgültig FAILED: braucht menschliche Sichtung, deshalb laut.
        console.error(`[outbox] AUFGEGEBEN seq=${sequence} — Eintrag steht auf FAILED.`);
      },
    },
  });

  const runOnce = process.argv.includes('--once');
  let stopping = false;
  const shutdown = async (): Promise<void> => {
    stopping = true;
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  do {
    try {
      const result = await outbox.drain();
      // Lag-Kennzahl für Dashboards: Alter des ältesten unveröffentlichten Eintrags.
      if (result.claimed === 0) {
        const oldest = await prisma.outboxEvent.findFirst({
          where: { status: { in: ['PENDING', 'PUBLISHING'] } },
          orderBy: { sequence: 'asc' },
        });
        const lag = outboxLagMs(
          oldest
            ? {
                sequence: oldest.sequence,
                eventId: oldest.eventId,
                aggregateType: oldest.aggregateType,
                aggregateId: oldest.aggregateId,
                eventType: oldest.eventType,
                payload: oldest.payload as Record<string, unknown>,
                status: oldest.status,
                attempts: oldest.attempts,
                availableAt: oldest.availableAt,
                createdAt: oldest.createdAt,
              }
            : undefined,
          new Date(),
        );
        if (lag > 30_000) {
          console.warn(`[outbox] Rückstand: ältester Eintrag ist ${Math.round(lag / 1000)}s alt.`);
        }
      }
    } catch (error) {
      // Ein Fehler darf die Schleife nicht beenden — der nächste Durchlauf greift
      // dieselben Einträge nach dem Sichtbarkeits-Timeout erneut.
      console.error('[outbox] Fehler im Durchlauf:', error);
    }
    if (runOnce || stopping) break;
    await new Promise((r) => setTimeout(r, DEFAULT_INTERVAL_MS));
  } while (!stopping);

  await prisma.$disconnect();
}

void main();
