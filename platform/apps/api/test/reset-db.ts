import type { PrismaClient } from '@prisma/client';

/**
 * Setzt die Datenbank für Tests zurück. Nutzt `TRUNCATE ... CASCADE`: das umgeht den
 * BEFORE-DELETE-Trigger auf `ledger_entries` (der wirklich nur Row-DELETE/UPDATE
 * blockiert) und löst FK-Abhängigkeiten in einem Schritt.
 */
export async function resetDb(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE ledger_entries, challenge_fundings, slots, submissions, winner_decisions, challenges, users RESTART IDENTITY CASCADE',
  );
}
