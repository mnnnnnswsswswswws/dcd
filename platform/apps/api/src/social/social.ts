import { Prisma, PrismaClient } from '@prisma/client';
import { apiError } from '@vcp/contracts';
import { z } from 'zod';

export interface SocialDeps {
  prisma: PrismaClient;
}

/** Like togglen: legt an oder entfernt; liefert neuen Zustand + Gesamtzahl. */
export async function toggleLike(
  deps: SocialDeps,
  challengeId: string,
  userId: string,
): Promise<{ liked: boolean; likeCount: number }> {
  const existing = await deps.prisma.challengeLike.findUnique({
    where: { challengeId_userId: { challengeId, userId } },
  });
  if (existing) {
    await deps.prisma.challengeLike.delete({ where: { id: existing.id } });
  } else {
    // Existenz der Challenge sicherstellen (FK würde sonst werfen).
    const exists = await deps.prisma.challenge.findUnique({ where: { id: challengeId }, select: { id: true } });
    if (exists === null) throw apiError('CHALLENGE_NOT_FOUND');
    await deps.prisma.challengeLike.create({ data: { challengeId, userId } });
  }
  const likeCount = await deps.prisma.challengeLike.count({ where: { challengeId } });
  return { liked: !existing, likeCount };
}

/** Bookmark ("Merken") togglen. */
export async function toggleBookmark(
  deps: SocialDeps,
  challengeId: string,
  userId: string,
): Promise<{ saved: boolean }> {
  const existing = await deps.prisma.challengeBookmark.findUnique({
    where: { challengeId_userId: { challengeId, userId } },
  });
  if (existing) {
    await deps.prisma.challengeBookmark.delete({ where: { id: existing.id } });
    return { saved: false };
  }
  const exists = await deps.prisma.challenge.findUnique({ where: { id: challengeId }, select: { id: true } });
  if (exists === null) throw apiError('CHALLENGE_NOT_FOUND');
  await deps.prisma.challengeBookmark.create({ data: { challengeId, userId } });
  return { saved: true };
}

const commentSchema = z.object({ body: z.string().trim().min(1).max(500) });

export interface CommentRow {
  id: string;
  body: string;
  createdAt: string;
  author: string;
}

function authorHandle(user: { username: string | null; displayName: string | null }, fallbackId: string): string {
  return user.username ?? user.displayName ?? `user_${fallbackId.slice(0, 6)}`;
}

/** Kommentar anlegen. */
export async function addComment(
  deps: SocialDeps,
  challengeId: string,
  userId: string,
  rawBody: unknown,
): Promise<CommentRow> {
  const parsed = commentSchema.safeParse(rawBody);
  if (!parsed.success) throw apiError('INVALID_INPUT');
  const exists = await deps.prisma.challenge.findUnique({ where: { id: challengeId }, select: { id: true } });
  if (exists === null) throw apiError('CHALLENGE_NOT_FOUND');

  const created = await deps.prisma.comment.create({
    data: { challengeId, userId, body: parsed.data.body },
    select: {
      id: true,
      body: true,
      createdAt: true,
      user: { select: { username: true, displayName: true } },
    },
  });
  return {
    id: created.id,
    body: created.body,
    createdAt: created.createdAt.toISOString(),
    author: authorHandle(created.user, userId),
  };
}

/** Kommentare einer Challenge (neueste zuerst). */
export async function listComments(deps: SocialDeps, challengeId: string): Promise<CommentRow[]> {
  const rows = await deps.prisma.comment.findMany({
    where: { challengeId },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true,
      body: true,
      createdAt: true,
      userId: true,
      user: { select: { username: true, displayName: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    createdAt: r.createdAt.toISOString(),
    author: authorHandle(r.user, r.userId),
  }));
}

export async function listMyLikeIds(deps: SocialDeps, userId: string): Promise<string[]> {
  const rows = await deps.prisma.challengeLike.findMany({ where: { userId }, select: { challengeId: true } });
  return rows.map((r) => r.challengeId);
}

export async function listMyBookmarkIds(deps: SocialDeps, userId: string): Promise<string[]> {
  const rows = await deps.prisma.challengeBookmark.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { challengeId: true },
  });
  return rows.map((r) => r.challengeId);
}

/** Like-/Kommentarzahlen für eine Menge von Challenges (für den Feed). */
export async function countsFor(
  deps: SocialDeps,
  challengeIds: string[],
): Promise<Map<string, { likeCount: number; commentCount: number }>> {
  const result = new Map<string, { likeCount: number; commentCount: number }>();
  if (challengeIds.length === 0) return result;
  const [likes, comments] = await Promise.all([
    deps.prisma.challengeLike.groupBy({ by: ['challengeId'], where: { challengeId: { in: challengeIds } }, _count: { _all: true } }),
    deps.prisma.comment.groupBy({ by: ['challengeId'], where: { challengeId: { in: challengeIds } }, _count: { _all: true } }),
  ]);
  for (const id of challengeIds) result.set(id, { likeCount: 0, commentCount: 0 });
  for (const l of likes) result.set(l.challengeId, { ...result.get(l.challengeId)!, likeCount: l._count._all });
  for (const c of comments) result.set(c.challengeId, { ...result.get(c.challengeId)!, commentCount: c._count._all });
  return result;
}

export type { Prisma };
