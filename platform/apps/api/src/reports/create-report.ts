import { PrismaClient } from '@prisma/client';
import { apiError } from '@vcp/contracts';
import { REPORT_REASONS, REPORT_TARGET_TYPES, reasonToPriority } from '@vcp/domain';
import { z } from 'zod';
import type { EventPublisher } from '../events/event-publisher.js';

const inputSchema = z.object({
  reporterId: z.string().uuid(),
  targetType: z.enum(REPORT_TARGET_TYPES),
  targetId: z.string().uuid(),
  reason: z.enum(REPORT_REASONS),
  description: z.string().trim().max(1000).optional(),
});

export type CreateReportInput = z.input<typeof inputSchema>;

export interface CreateReportDeps {
  prisma: PrismaClient;
  events: EventPublisher;
  now?: () => Date;
}

export interface CreateReportResult {
  id: string;
  status: 'OPEN';
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
}

/**
 * Legt eine Nutzer-Meldung an (Spec 14.5). Die Bearbeitungspriorität wird aus dem
 * Meldegrund abgeleitet; schwere Gründe (z. B. Minderjährige, Gewalt) landen mit
 * `HIGH` in der Moderationsqueue.
 */
export async function createReport(
  deps: CreateReportDeps,
  rawInput: CreateReportInput,
): Promise<CreateReportResult> {
  const parsed = inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw apiError('INVALID_INPUT');
  }
  const input = parsed.data;
  const now = deps.now?.() ?? new Date();
  const priority = reasonToPriority(input.reason);

  const report = await deps.prisma.report.create({
    data: {
      reporterId: input.reporterId,
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason,
      description: input.description,
      status: 'OPEN',
      priority,
    },
  });

  await deps.events.publish({
    type: 'report.created',
    occurredAt: now,
    payload: { reportId: report.id, targetType: input.targetType, targetId: input.targetId, priority },
  });

  return { id: report.id, status: 'OPEN', priority };
}
