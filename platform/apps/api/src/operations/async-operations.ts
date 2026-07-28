/**
 * Asynchrone Operationen hinter `202 Accepted` (Scale S1, Aufgabe 10;
 * Architekturregel 7: lange und nichtkritische Arbeit läuft asynchron).
 *
 * Muster: Der Request legt eine Operation an, gibt sofort `202` mit einer
 * Verfolgungs-URL zurück und ist fertig. Die eigentliche Arbeit — allen voran die
 * Videoverarbeitung — läuft im Worker. Der Client fragt `GET /v1/operations/:id`
 * ab, statt eine Verbindung offen zu halten.
 *
 * Der Zustandsübergang ist bewusst eng: Eine abgeschlossene Operation
 * (`SUCCEEDED`/`FAILED`) ist endgültig. Das macht wiederholte Worker-Zustellungen
 * (at-least-once) unschädlich, ohne dass der Aufrufer Sonderfälle behandeln muss.
 */

import type { AsyncOperationStatus, PrismaClient } from '@prisma/client';

/** Fachliche Arten asynchroner Arbeit. */
export const OperationKind = {
  VIDEO_PROCESSING: 'VIDEO_PROCESSING',
  VIDEO_MODERATION: 'VIDEO_MODERATION',
  PROJECTION_REBUILD: 'PROJECTION_REBUILD',
} as const;
export type OperationKind = (typeof OperationKind)[keyof typeof OperationKind];

/** Wie lange eine abgeschlossene Operation abrufbar bleibt. */
export const OPERATION_TTL_MS = 24 * 60 * 60 * 1000;

export interface CreateOperationInput {
  readonly kind: OperationKind;
  readonly ownerUserId?: string;
  readonly resourceType?: string;
  readonly resourceId?: string;
}

export interface OperationView {
  readonly id: string;
  readonly kind: string;
  readonly status: AsyncOperationStatus;
  readonly progress: number;
  readonly resourceType: string | null;
  readonly resourceId: string | null;
  readonly result: unknown;
  readonly error: { code: string; message: string } | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function toOperationView(op: {
  id: string;
  kind: string;
  status: AsyncOperationStatus;
  progress: number;
  resourceType: string | null;
  resourceId: string | null;
  resultJson: unknown;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}): OperationView {
  return {
    id: op.id,
    kind: op.kind,
    status: op.status,
    progress: op.progress,
    resourceType: op.resourceType,
    resourceId: op.resourceId,
    result: op.resultJson ?? null,
    error:
      op.errorCode !== null
        ? { code: op.errorCode, message: op.errorMessage ?? '' }
        : null,
    createdAt: op.createdAt.toISOString(),
    updatedAt: op.updatedAt.toISOString(),
  };
}

/** Legt eine Operation an. Der Aufrufer antwortet danach mit `202` und der ID. */
export async function createOperation(
  prisma: PrismaClient,
  input: CreateOperationInput,
  now: Date = new Date(),
): Promise<OperationView> {
  const op = await prisma.asyncOperation.create({
    data: {
      kind: input.kind,
      status: 'PENDING',
      ownerUserId: input.ownerUserId ?? null,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      expiresAt: new Date(now.getTime() + OPERATION_TTL_MS),
    },
  });
  return toOperationView(op);
}

/**
 * Liest eine Operation. `ownerUserId` erzwingt, dass ein Nutzer nur seine eigenen
 * Operationen sieht — der Status kann Ressourcen-IDs enthalten und ist damit
 * personenbezogen. `null` bedeutet „nicht vorhanden oder nicht zugänglich"; beides
 * wird bewusst gleich behandelt, damit die Antwort keine fremde Existenz verrät.
 */
export async function getOperation(
  prisma: PrismaClient,
  id: string,
  ownerUserId?: string,
): Promise<OperationView | null> {
  const op = await prisma.asyncOperation.findUnique({ where: { id } });
  if (op === null) return null;
  if (op.ownerUserId !== null && ownerUserId !== undefined && op.ownerUserId !== ownerUserId) {
    return null;
  }
  return toOperationView(op);
}

/** Terminale Zustände: einmal erreicht, unveränderlich. */
const TERMINAL: readonly AsyncOperationStatus[] = ['SUCCEEDED', 'FAILED'];

export function isTerminal(status: AsyncOperationStatus): boolean {
  return TERMINAL.includes(status);
}

export const TransitionOutcome = {
  APPLIED: 'APPLIED',
  /** Operation ist bereits abgeschlossen — erneuter Aufruf bleibt folgenlos. */
  ALREADY_TERMINAL: 'ALREADY_TERMINAL',
  NOT_FOUND: 'NOT_FOUND',
} as const;
export type TransitionOutcome = (typeof TransitionOutcome)[keyof typeof TransitionOutcome];

/**
 * Setzt eine Operation auf `RUNNING` und meldet Fortschritt.
 *
 * Idempotent gegenüber Mehrfachzustellung: Ist die Operation bereits terminal,
 * passiert nichts. Fortschritt wird zudem nie rückwärts geschrieben, damit eine
 * verspätete ältere Nachricht die Anzeige nicht zurückspringen lässt.
 */
export async function markRunning(
  prisma: PrismaClient,
  id: string,
  progress = 0,
): Promise<TransitionOutcome> {
  return prisma.$transaction(async (tx) => {
    const op = await tx.asyncOperation.findUnique({ where: { id } });
    if (op === null) return TransitionOutcome.NOT_FOUND;
    if (isTerminal(op.status)) return TransitionOutcome.ALREADY_TERMINAL;

    await tx.asyncOperation.update({
      where: { id },
      data: {
        status: 'RUNNING',
        progress: Math.max(op.progress, Math.min(100, Math.max(0, progress))),
      },
    });
    return TransitionOutcome.APPLIED;
  });
}

export async function markSucceeded(
  prisma: PrismaClient,
  id: string,
  result?: Record<string, unknown>,
  now: Date = new Date(),
): Promise<TransitionOutcome> {
  return prisma.$transaction(async (tx) => {
    const op = await tx.asyncOperation.findUnique({ where: { id } });
    if (op === null) return TransitionOutcome.NOT_FOUND;
    if (isTerminal(op.status)) return TransitionOutcome.ALREADY_TERMINAL;

    await tx.asyncOperation.update({
      where: { id },
      data: {
        status: 'SUCCEEDED',
        progress: 100,
        resultJson: (result ?? {}) as never,
        errorCode: null,
        errorMessage: null,
        expiresAt: new Date(now.getTime() + OPERATION_TTL_MS),
      },
    });
    return TransitionOutcome.APPLIED;
  });
}

export async function markFailed(
  prisma: PrismaClient,
  id: string,
  errorCode: string,
  errorMessage: string,
  now: Date = new Date(),
): Promise<TransitionOutcome> {
  return prisma.$transaction(async (tx) => {
    const op = await tx.asyncOperation.findUnique({ where: { id } });
    if (op === null) return TransitionOutcome.NOT_FOUND;
    if (isTerminal(op.status)) return TransitionOutcome.ALREADY_TERMINAL;

    await tx.asyncOperation.update({
      where: { id },
      data: {
        status: 'FAILED',
        errorCode,
        errorMessage,
        expiresAt: new Date(now.getTime() + OPERATION_TTL_MS),
      },
    });
    return TransitionOutcome.APPLIED;
  });
}

/** Räumt abgelaufene Operationen ab (Retention). */
export async function purgeExpiredOperations(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<number> {
  const { count } = await prisma.asyncOperation.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  return count;
}
