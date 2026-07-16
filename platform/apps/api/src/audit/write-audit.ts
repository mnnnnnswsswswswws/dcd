import type { Prisma } from '@prisma/client';

export type AuditActorType = 'USER' | 'ADMIN' | 'SYSTEM';

export interface AuditEntry {
  actorType: AuditActorType;
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  requestId?: string | null;
}

/**
 * Schreibt einen revisionssicheren Audit-Log-Eintrag **innerhalb** der übergebenen
 * Transaktion — dadurch ist die Protokollierung atomar mit der Zustandsänderung.
 * `audit_logs` ist per DB-Trigger append-only.
 */
export async function writeAudit(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorType: entry.actorType,
      actorId: entry.actorId ?? null,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      beforeJson: entry.before,
      afterJson: entry.after,
      requestId: entry.requestId ?? null,
    },
  });
}
