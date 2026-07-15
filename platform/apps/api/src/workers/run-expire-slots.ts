import { PrismaClient } from '@prisma/client';
import { loadEnv } from '@vcp/config';
import { LoggingEventPublisher } from '../events/event-publisher.js';
import { expireSlots } from './expire-slots.js';

/**
 * Eigenständiger Runner für den Slot-Expiration-Worker.
 *
 * Produktiv wird dieser Sweep von Cloud Scheduler / Cloud Tasks angestoßen; lokal
 * genügt ein Intervall-Loop. Ein einzelner Durchlauf ist idempotent und kann
 * gefahrlos beliebig oft laufen.
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
      const result = await expireSlots({ prisma, events });
      if (result.expiredSlotCount > 0) {
        // eslint-disable-next-line no-console
        console.log(
          `[expire-slots] freigegeben=${result.expiredSlotCount} ` +
            `reopened=${result.reopenedChallengeIds.length} ` +
            `challenges=${result.processedChallengeIds.length}`,
        );
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[expire-slots] Fehler im Durchlauf:', error);
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
