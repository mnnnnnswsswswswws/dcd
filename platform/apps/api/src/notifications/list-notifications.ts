import { PrismaClient } from '@prisma/client';

export interface ListNotificationsDeps {
  prisma: PrismaClient;
}

export interface NotificationRow {
  id: string;
  type: string;
  challengeId: string | null;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

export interface ListNotificationsResult {
  unreadCount: number;
  items: NotificationRow[];
}

/** Benachrichtigungen eines Nutzers (neueste zuerst) samt Anzahl ungelesener. */
export async function listNotifications(
  deps: ListNotificationsDeps,
  userId: string,
): Promise<ListNotificationsResult> {
  const [rows, unreadCount] = await Promise.all([
    deps.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, type: true, challengeId: true, title: true, body: true, readAt: true, createdAt: true },
    }),
    deps.prisma.notification.count({ where: { userId, readAt: null } }),
  ]);

  return {
    unreadCount,
    items: rows.map((r) => ({
      id: r.id,
      type: r.type,
      challengeId: r.challengeId,
      title: r.title,
      body: r.body,
      read: r.readAt !== null,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

/** Markiert alle ungelesenen Benachrichtigungen des Nutzers als gelesen. */
export async function markAllNotificationsRead(
  deps: ListNotificationsDeps,
  userId: string,
  now: Date = new Date(),
): Promise<{ marked: number }> {
  const result = await deps.prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: now },
  });
  return { marked: result.count };
}
