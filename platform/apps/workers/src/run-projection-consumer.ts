import { PrismaClient } from '@prisma/client';
import { loadEnv } from '@vcp/config';
import {
  ProjectionOutcome,
  applyChallengeProjection,
  consumeFromOutbox,
  createPooledPrismaClient,
} from '@vcp/api';

/**
 * Projektions-Consumer-Worker.
 *
 * Schließt die Event-Kette: Outbox → Publisher → **Consumer** → Read Model.
 *
 * Zwei Betriebsarten, weil die Kette sonst nur mit Cloud-Zugang lauffähig wäre:
 *
 *   • **Abonnement** (`PUBSUB_SUBSCRIPTION` gesetzt): Der Consumer hängt an Pub/Sub
 *     und verarbeitet zugestellte Nachrichten. Das ist der Produktionsweg.
 *
 *   • **Direktmodus** (Standard): Der Consumer liest bereits veröffentlichte Einträge
 *     direkt aus `outbox_events` ab dem Checkpoint. Damit ist die vollständige Kette
 *     lokal und in CI ohne Credentials nachvollziehbar — und der Modus ist zugleich
 *     das Werkzeug für den Wiederaufbau nach einem Logikwechsel.
 *
 * Beide Wege laufen durch dieselbe idempotente, out-of-order-feste Anwendung. Der
 * Direktmodus ist deshalb kein Sonderpfad mit eigener Semantik, sondern dieselbe
 * Verarbeitung mit anderer Quelle.
 */

const POLL_INTERVAL_MS = 1_000;

/** Minimaler Abonnement-Port, spiegelbildlich zum TopicClient des Publishers. */
interface SubscriptionClient {
  on(event: 'message', handler: (msg: BrokerMessage) => void): void;
  on(event: 'error', handler: (err: Error) => void): void;
}

interface BrokerMessage {
  readonly id: string;
  readonly data: Buffer;
  readonly attributes: Record<string, string>;
  ack(): void;
  nack(): void;
}

/** Produktionsweg: an Pub/Sub hängen und zugestellte Nachrichten verarbeiten. */
async function runSubscription(prisma: PrismaClient, subscriptionName: string): Promise<void> {
  // Variablen-Spezifizierer: `@google-cloud/pubsub` bleibt optional (siehe Publisher).
  const specifier = '@google-cloud/pubsub';
  const mod = (await import(specifier)) as unknown as {
    PubSub: new () => { subscription(name: string): SubscriptionClient };
  };
  const sub = new mod.PubSub().subscription(subscriptionName);
  console.log(`[projection] Abonnement aktiv: ${subscriptionName}`);

  sub.on('message', (msg: BrokerMessage) => {
    void (async () => {
      try {
        const body = JSON.parse(msg.data.toString('utf8')) as {
          eventId: string;
          eventType: string;
          aggregateType: string;
          aggregateId: string;
          sequence: string;
          payload: Record<string, unknown>;
        };
        const result = await applyChallengeProjection(prisma, {
          // Die eventId aus dem Publisher ist der Deduplizierungsschlüssel.
          messageId: body.eventId,
          eventType: body.eventType,
          aggregateType: body.aggregateType,
          aggregateId: body.aggregateId,
          sequence: BigInt(body.sequence),
          payload: body.payload,
        });
        // Auch DUPLICATE und STALE werden bestätigt: Beide sind korrekt behandelt,
        // ein nack würde sie nur endlos wiederbringen.
        msg.ack();
        if (result.outcome === ProjectionOutcome.APPLIED) {
          console.log(`[projection] angewandt ${body.eventType} seq=${body.sequence}`);
        }
      } catch (err) {
        // Nur bei echtem Fehler zurückgeben — dann liefert Pub/Sub erneut.
        console.error('[projection] Fehler, nack:', err);
        msg.nack();
      }
    })();
  });

  sub.on('error', (err: Error) => {
    console.error('[projection] Abonnementfehler:', err.message);
  });

  // Der Prozess bleibt für die Zustellung offen.
  await new Promise<void>(() => {});
}

async function main(): Promise<void> {
  loadEnv();
  const prisma = createPooledPrismaClient(PrismaClient);
  const subscription = process.env.PUBSUB_SUBSCRIPTION;

  const shutdown = async (): Promise<void> => {
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  if (subscription) {
    await runSubscription(prisma, subscription);
    return;
  }

  console.log('[projection] PUBSUB_SUBSCRIPTION nicht gesetzt — Direktmodus aus der Outbox.');
  const runOnce = process.argv.includes('--once');
  for (;;) {
    try {
      const stats = await consumeFromOutbox(prisma);
      if (stats.processed > 0) {
        console.log(
          `[projection] verarbeitet=${stats.processed} angewandt=${stats.applied} ` +
            `duplikate=${stats.duplicates} veraltet=${stats.stale} ignoriert=${stats.ignored}`,
        );
      }
    } catch (error) {
      // Ein Fehler darf die Schleife nicht beenden; der Checkpoint bleibt stehen,
      // sodass der nächste Durchlauf dieselben Einträge erneut greift.
      console.error('[projection] Fehler im Durchlauf:', error);
    }
    if (runOnce) break;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  await prisma.$disconnect();
}

void main();
