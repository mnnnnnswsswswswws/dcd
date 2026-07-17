import { PrismaClient } from '@prisma/client';
import { LoggingEventPublisher } from '@vcp/api';

const DEFAULT_INTERVAL_MS = 30_000;

export interface WorkerContext {
  prisma: PrismaClient;
  events: LoggingEventPublisher;
}

/**
 * Führt eine Worker-Funktion in einer Schleife aus. `--once` (Argument) läuft genau
 * einen Durchlauf und beendet — ideal für Cloud-Scheduler-getriggerte Cloud-Run-Jobs.
 * Jeder Durchlauf ist idempotent; Fehler werden geloggt, brechen die Schleife nicht ab.
 */
export async function runLoop(
  name: string,
  tick: (ctx: WorkerContext) => Promise<void>,
  intervalMs = DEFAULT_INTERVAL_MS,
): Promise<void> {
  const prisma = new PrismaClient();
  const events = new LoggingEventPublisher();
  const ctx: WorkerContext = { prisma, events };

  const runOnce = process.argv.includes('--once');
  const shutdown = async (): Promise<void> => {
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  do {
    try {
      await tick(ctx);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`[${name}] Fehler im Durchlauf:`, error);
    }
    if (runOnce) break;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    // eslint-disable-next-line no-constant-condition
  } while (true);

  await prisma.$disconnect();
}
