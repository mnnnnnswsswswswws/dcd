import { PrismaClient } from '@prisma/client';
import { apiError } from '@vcp/contracts';
import type { EventPublisher } from '../events/event-publisher.js';

export interface RegisterUserDeps {
  prisma: PrismaClient;
  events: EventPublisher;
  now?: () => Date;
}

export interface RegisterUserInput {
  isAdult: boolean;
}

export interface RegisterUserResult {
  id: string;
  isAdult: boolean;
}

/**
 * Legt einen Nutzer an. 18+-Gate: ohne bestätigte Volljährigkeit wird die
 * Registrierung abgelehnt (Plattform ist ausschließlich 18+). Die zurückgegebene ID
 * dient im Mock-Auth-Setup als Bearer-Token.
 */
export async function registerUser(
  deps: RegisterUserDeps,
  input: RegisterUserInput,
): Promise<RegisterUserResult> {
  if (input.isAdult !== true) {
    throw apiError('UNDERAGE');
  }
  const now = deps.now?.() ?? new Date();

  const user = await deps.prisma.user.create({ data: { isAdult: true } });

  await deps.events.publish({
    type: 'user.registered',
    occurredAt: now,
    payload: { userId: user.id },
  });

  return { id: user.id, isAdult: user.isAdult };
}
