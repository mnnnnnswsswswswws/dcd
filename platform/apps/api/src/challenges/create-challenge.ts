import { randomUUID } from 'node:crypto';
import { PrismaClient, type ChallengeStatus, type SelectionMode } from '@prisma/client';
import { apiError } from '@vcp/contracts';
import type { PaymentProvider } from '@vcp/payments';
import { z } from 'zod';
import type { EventPublisher } from '../events/event-publisher.js';

const MAX_SLOTS = 10;
const PROVIDER_NAME = 'mock';

const inputSchema = z.object({
  creatorId: z.string().uuid(),
  selectionMode: z.enum(['CREATOR_DECIDES', 'COMMUNITY_VOTE']),
  prizeAmountCents: z.number().int().positive(),
  submissionDeadline: z.coerce.date(),
});

export type CreateChallengeInput = z.input<typeof inputSchema>;

export interface CreateChallengeDeps {
  prisma: PrismaClient;
  payments: PaymentProvider;
  events: EventPublisher;
  now?: () => Date;
}

export interface CreateChallengeResult {
  challenge: {
    id: string;
    status: ChallengeStatus;
    selectionMode: SelectionMode;
    prizeAmountCents: number;
    maxSlots: number;
    submissionDeadline: Date | null;
  };
  funding: {
    providerRef: string;
    clientSecret: string;
    amountCents: number;
  };
}

/**
 * Erstellt eine Challenge im Zustand `PENDING_FUNDING` und eine Finanzierungs-Absicht
 * über die Preissumme. Die Challenge wird **nicht** hier veröffentlicht — das
 * geschieht ausschließlich nach bestätigter Vollfinanzierung per Webhook
 * (`confirmFunding`). Auswahlmodus, Preis und Frist werden hier fixiert.
 */
export async function createChallenge(
  deps: CreateChallengeDeps,
  rawInput: CreateChallengeInput,
): Promise<CreateChallengeResult> {
  const now = deps.now?.() ?? new Date();

  const parsed = inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw apiError('INVALID_INPUT');
  }
  const input = parsed.data;
  if (input.submissionDeadline <= now) {
    throw apiError('INVALID_INPUT');
  }

  const challengeId = randomUUID();
  const idempotencyKey = `challenge:${challengeId}:funding`;

  // Finanzierungs-Absicht beim Provider (idempotent) erzeugen.
  const intent = await deps.payments.createFundingIntent({
    amountCents: input.prizeAmountCents,
    currency: 'eur',
    idempotencyKey,
    metadata: { challengeId },
  });

  // Challenge + Finanzierungssatz atomar anlegen.
  const created = await deps.prisma.$transaction(async (tx) => {
    const challenge = await tx.challenge.create({
      data: {
        id: challengeId,
        creatorId: input.creatorId,
        status: 'PENDING_FUNDING',
        selectionMode: input.selectionMode,
        prizeAmountCents: input.prizeAmountCents,
        maxSlots: MAX_SLOTS,
        submissionDeadline: input.submissionDeadline,
      },
    });
    await tx.challengeFunding.create({
      data: {
        challengeId,
        provider: PROVIDER_NAME,
        providerRef: intent.providerRef,
        idempotencyKey,
        amountCents: input.prizeAmountCents,
        currency: 'eur',
        status: 'PENDING',
      },
    });
    return challenge;
  });

  await deps.events.publish({
    type: 'challenge.created',
    occurredAt: now,
    payload: { challengeId, creatorId: input.creatorId, providerRef: intent.providerRef },
  });

  return {
    challenge: {
      id: created.id,
      status: created.status,
      selectionMode: created.selectionMode,
      prizeAmountCents: created.prizeAmountCents,
      maxSlots: created.maxSlots,
      submissionDeadline: created.submissionDeadline,
    },
    funding: {
      providerRef: intent.providerRef,
      clientSecret: intent.clientSecret,
      amountCents: intent.amountCents,
    },
  };
}
