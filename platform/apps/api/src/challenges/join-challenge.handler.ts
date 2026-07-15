import { AppError, toApiErrorBody } from '@vcp/contracts';
import type { EventPublisher } from '../events/event-publisher.js';
import { joinChallenge, type JoinChallengeDeps } from './join-challenge.js';
import type { PrismaClient } from '@prisma/client';

/**
 * Framework-agnostischer Adapter für `POST /v1/challenges/:id/join`.
 *
 * Bewusst ohne NestJS-DI gehalten, damit die transaktionssichere Kernfunktion
 * direkt testbar bleibt. Die Anbindung an den NestController (AppCheckGuard +
 * FirebaseAuthGuard liefern `userId`) ist ein dünner Wrapper um diese Funktion.
 */
export interface JoinChallengeHttpResponse {
  status: number;
  body: unknown;
}

export async function handleJoinChallenge(
  deps: { prisma: PrismaClient; events: EventPublisher } & Pick<JoinChallengeDeps, 'now' | 'reservationTtlMs'>,
  params: { challengeId: string; userId: string },
): Promise<JoinChallengeHttpResponse> {
  try {
    const result = await joinChallenge(deps, params);
    return { status: 201, body: result };
  } catch (error) {
    if (error instanceof AppError) {
      return { status: error.httpStatus, body: toApiErrorBody(error) };
    }
    throw error;
  }
}
