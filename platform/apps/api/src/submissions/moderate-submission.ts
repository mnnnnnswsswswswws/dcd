import { PrismaClient } from '@prisma/client';
import { apiError } from '@vcp/contracts';
import type { EventPublisher } from '../events/event-publisher.js';

export interface ModerateSubmissionDeps {
  prisma: PrismaClient;
  events: EventPublisher;
  now?: () => Date;
}

export interface ModerateSubmissionInput {
  submissionId: string;
  decision: 'APPROVED' | 'REJECTED';
  isAdmin: boolean;
}

export interface ModerateSubmissionResult {
  submissionId: string;
  status: 'APPROVED' | 'REJECTED';
}

/**
 * Moderationsentscheidung über eine Einsendung. Nur `APPROVED` ist gewinnberechtigt.
 * Erfordert Admin-Rechte. `finalizedAt` wird bei Freigabe gesetzt (Tie-Break-Kriterium
 * für die Community-Auswahl).
 */
export async function moderateSubmission(
  deps: ModerateSubmissionDeps,
  input: ModerateSubmissionInput,
): Promise<ModerateSubmissionResult> {
  if (!input.isAdmin) {
    throw apiError('NOT_ADMIN');
  }
  const now = deps.now?.() ?? new Date();

  const result = await deps.prisma.$transaction(async (tx) => {
    const submission = await tx.submission.findUnique({ where: { id: input.submissionId } });
    if (submission === null) {
      throw apiError('SUBMISSION_NOT_FOUND');
    }
    if (submission.status !== 'SUBMITTED') {
      throw apiError('SUBMISSION_NOT_ELIGIBLE');
    }

    const updated = await tx.submission.update({
      where: { id: submission.id },
      data: {
        status: input.decision,
        finalizedAt: input.decision === 'APPROVED' ? now : null,
      },
    });
    return { challengeId: submission.challengeId, status: updated.status };
  });

  await deps.events.publish({
    type: 'submission.moderated',
    occurredAt: now,
    payload: { submissionId: input.submissionId, challengeId: result.challengeId, decision: input.decision },
  });

  return { submissionId: input.submissionId, status: input.decision };
}
