import { Prisma, PrismaClient } from '@prisma/client';
import { apiError } from '@vcp/contracts';
import { z } from 'zod';

/** Nutzername: klein, 3–20 Zeichen, a–z 0–9 und _; reservierte Wörter ausgeschlossen. */
const RESERVED = new Set(['me', 'admin', 'api', 'null', 'undefined', 'profiles', 'user', 'users']);

const inputSchema = z.object({
  userId: z.string().uuid(),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_]{3,20}$/)
    .optional(),
  displayName: z.string().trim().min(1).max(40).optional(),
  bio: z.string().trim().max(200).optional(),
});

export type UpdateProfileInput = z.input<typeof inputSchema>;

export interface UpdateProfileDeps {
  prisma: PrismaClient;
}

export interface ProfileResult {
  id: string;
  username: string | null;
  displayName: string | null;
  bio: string | null;
}

/**
 * Aktualisiert das eigene Profil. Nur gesetzte Felder werden geändert. Der Nutzername ist
 * eindeutig (case-insensitiv über Lowercasing) und gegen reservierte Wörter geprüft.
 */
export async function updateProfile(
  deps: UpdateProfileDeps,
  rawInput: UpdateProfileInput,
): Promise<ProfileResult> {
  const parsed = inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw apiError('INVALID_INPUT');
  }
  const input = parsed.data;
  if (input.username !== undefined && RESERVED.has(input.username)) {
    throw apiError('USERNAME_TAKEN');
  }

  const data: Prisma.UserUpdateInput = {};
  if (input.username !== undefined) data.username = input.username;
  if (input.displayName !== undefined) data.displayName = input.displayName;
  if (input.bio !== undefined) data.bio = input.bio;

  try {
    const user = await deps.prisma.user.update({
      where: { id: input.userId },
      data,
      select: { id: true, username: true, displayName: true, bio: true },
    });
    return user;
  } catch (e) {
    // Prisma P2002 = Verletzung eines Unique-Constraints (Nutzername vergeben).
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw apiError('USERNAME_TAKEN');
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      throw apiError('USER_NOT_FOUND');
    }
    throw e;
  }
}
