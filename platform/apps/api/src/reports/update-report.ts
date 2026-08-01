import { PrismaClient } from '@prisma/client';
import { apiError } from '@vcp/contracts';
import { REPORT_STATUSES, canTransitionReport, type ReportStatus } from '@vcp/domain';
import { z } from 'zod';
import type { EventPublisher } from '../events/event-publisher.js';

const inputSchema = z.object({
  reportId: z.string().uuid(),
  status: z.enum(REPORT_STATUSES),
  isAdmin: z.boolean(),
});

export type UpdateReportInput = z.input<typeof inputSchema>;

export interface UpdateReportDeps {
  prisma: PrismaClient;
  events: EventPublisher;
  now?: () => Date;
}

export interface UpdateReportResult {
  id: string;
  status: ReportStatus;
}

/**
 * Setzt den Bearbeitungsstatus einer Meldung (nur Admin). Übergänge folgen der
 * Domänenmatrix — RESOLVED/DISMISSED sind terminal und lassen sich nicht zurückdrehen.
 */
export async function updateReport(
  deps: UpdateReportDeps,
  rawInput: UpdateReportInput,
): Promise<UpdateReportResult> {
  const parsed = inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw apiError('INVALID_INPUT');
  }
  const input = parsed.data;
  if (!input.isAdmin) {
    throw apiError('NOT_ADMIN');
  }
  const now = deps.now?.() ?? new Date();

  const existing = await deps.prisma.report.findUnique({
    where: { id: input.reportId },
    select: { status: true },
  });
  if (existing === null) {
    throw apiError('REPORT_NOT_FOUND');
  }
  const from = existing.status as ReportStatus;
  if (from === input.status) {
    return { id: input.reportId, status: from };
  }
  if (!canTransitionReport(from, input.status)) {
    throw apiError('REPORT_INVALID_STATE');
  }

  const updated = await deps.prisma.report.update({
    where: { id: input.reportId },
    data: { status: input.status },
    select: { id: true, status: true },
  });

  await deps.events.publish({
    type: 'report.updated',
    occurredAt: now,
    payload: { reportId: updated.id, from, to: input.status },
  });

  return { id: updated.id, status: updated.status as ReportStatus };
}
