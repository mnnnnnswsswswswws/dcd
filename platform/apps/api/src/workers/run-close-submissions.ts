import { PrismaClient } from '@prisma/client';
import { loadEnv } from '@vcp/config';
import { LoggingEventPublisher } from '../events/event-publisher.js';
import { closeExpiredSubmissions } from './close-expired-submissions.js';

/**
 * Runner für den Fristen-Worker. Produktiv durch Cloud Scheduler ausgelöst; lokal ein
 * Intervall-Loop. Ein Durchlauf ist idempotent.
 */
const SWEEP_INTERVAL_MS = 30_000;

async function main(): Promise<void> {
  loadEnv();
  const prisma = new PrismaClient();
  const events = new LoggingEventPublisher();

  const runOnce = process.argv.includes('--once');
  const shutdown = async (): Promise<void> => {
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  do {
    try {
      const result = await closeExpiredSubmissions({ prisma, events });
      if (result.closedChallengeIds.length > 0) {
        // eslint-disable-next-line no-console
        console.log(`[close-submissions] geschlossen=${result.closedChallengeIds.length}`);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[close-submissions] Fehler im Durchlauf:', error);
    }
    if (runOnce) break;
    await new Promise((resolve) => setTimeout(resolve, SWEEP_INTERVAL_MS));
    // eslint-disable-next-line no-constant-condition
  } while (true);

  await prisma.$disconnect();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
