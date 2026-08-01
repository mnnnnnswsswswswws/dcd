import type { PrismaClient } from '@prisma/client';

/**
 * Setzt die Datenbank für Tests zurück. Nutzt `TRUNCATE ... CASCADE`: das umgeht den
 * BEFORE-DELETE-Trigger auf `ledger_entries` (der wirklich nur Row-DELETE/UPDATE
 * blockiert) und löst FK-Abhängigkeiten in einem Schritt.
 */
export async function resetDb(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE comments, challenge_likes, challenge_bookmarks, notifications, reports, audit_logs, ledger_entries, payouts, challenge_fundings, votes, evidence_assets, slots, submissions, winner_decisions, challenge_criteria, challenges, users, outbox_events, processed_messages, challenge_public_projections, projection_checkpoints, async_operations RESTART IDENTITY CASCADE',
  );
}
