import type { Prisma } from '@prisma/client';

export interface NotificationEntry {
  userId: string;
  type: string;
  title: string;
  body: string;
  challengeId?: string | null;
}

/**
 * Schreibt eine In-App-Benachrichtigung **innerhalb** der übergebenen Transaktion —
 * damit ist die Zustellung atomar mit der auslösenden Zustandsänderung. Analog zu
 * `writeAudit`.
 */
export async function writeNotification(
  tx: Prisma.TransactionClient,
  entry: NotificationEntry,
): Promise<void> {
  await tx.notification.create({
    data: {
      userId: entry.userId,
      type: entry.type,
      title: entry.title,
      body: entry.body,
      challengeId: entry.challengeId ?? null,
    },
  });
}
