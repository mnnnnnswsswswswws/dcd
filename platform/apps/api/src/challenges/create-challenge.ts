import { randomUUID } from 'node:crypto';
import { PrismaClient, type ChallengeStatus, type SelectionMode } from '@prisma/client';
import { apiError } from '@vcp/contracts';
import type { PaymentProvider } from '@vcp/payments';
import { z } from 'zod';
import type { EventPublisher } from '../events/event-publisher.js';

const MAX_SLOTS = 10;
const PROVIDER_NAME = 'mock';

const criterionSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional(),
  mandatory: z.boolean().optional(),
  evidenceType: z.string().trim().max(100).optional(),
});

const inputSchema = z.object({
  creatorId: z.string().uuid(),
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(2000).optional(),
  category: z.string().trim().max(80).optional(),
  selectionMode: z.enum(['CREATOR_DECIDES', 'COMMUNITY_VOTE']),
  prizeAmountCents: z.number().int().positive(),
  submissionDeadline: z.coerce.date(),
  criteria: z.array(criterionSchema).max(20).optional(),
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
    title: string;
    category: string | null;
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
        title: input.title,
        description: input.description,
        category: input.category,
        status: 'PENDING_FUNDING',
        selectionMode: input.selectionMode,
        prizeAmountCents: input.prizeAmountCents,
        maxSlots: MAX_SLOTS,
        submissionDeadline: input.submissionDeadline,
      },
    });
    if (input.criteria && input.criteria.length > 0) {
      await tx.challengeCriterion.createMany({
        data: input.criteria.map((c, index) => ({
          challengeId,
          title: c.title,
          description: c.description,
          mandatory: c.mandatory ?? true,
          evidenceType: c.evidenceType,
          sortOrder: index,
        })),
      });
    }
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
      title: created.title,
      category: created.category,
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
