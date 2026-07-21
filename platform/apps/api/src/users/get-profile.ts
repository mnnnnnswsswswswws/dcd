import { PrismaClient } from '@prisma/client';
import { apiError } from '@vcp/contracts';

export interface GetProfileDeps {
  prisma: PrismaClient;
}

export interface PublicProfile {
  username: string;
  displayName: string | null;
  bio: string | null;
  joinedAt: string;
  createdCount: number;
  participatedCount: number;
  wonCount: number;
}

/**
 * Öffentliches Profil per Nutzername samt schlanker Kennzahlen (erstellte/beigetretene
 * Challenges, Siege). Kein privater Bezug (keine IDs, keine E-Mail).
 */
export async function getProfileByUsername(
  deps: GetProfileDeps,
  usernameRaw: string,
): Promise<PublicProfile> {
  const username = usernameRaw.trim().toLowerCase();
  const user = await deps.prisma.user.findUnique({
    where: { username },
    select: { id: true, username: true, displayName: true, bio: true, createdAt: true },
  });
  if (user === null || user.username === null) {
    throw apiError('USER_NOT_FOUND');
  }

  const [createdCount, participatedCount, wonCount] = await Promise.all([
    deps.prisma.challenge.count({ where: { creatorId: user.id } }),
    deps.prisma.slot.count({ where: { participantId: user.id } }),
    deps.prisma.submission.count({ where: { participantId: user.id, status: 'WINNER' } }),
  ]);

  return {
    username: user.username,
    displayName: user.displayName,
    bio: user.bio,
    joinedAt: user.createdAt.toISOString(),
    createdCount,
    participatedCount,
    wonCount,
  };
}
