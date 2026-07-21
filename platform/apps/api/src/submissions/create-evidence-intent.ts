import { Prisma, PrismaClient, type ChallengeStatus } from '@prisma/client';
import { apiError } from '@vcp/contracts';
import { COUNTING_SLOT_STATUSES } from '@vcp/domain';
import type { EvidenceStorageProvider } from '../storage/storage-provider.js';

const COUNTING = COUNTING_SLOT_STATUSES as unknown as string[];

export interface CreateEvidenceIntentDeps {
  prisma: PrismaClient;
  storage: EvidenceStorageProvider;
  now?: () => Date;
}

export interface CreateEvidenceIntentInput {
  challengeId: string;
  userId: string;
  contentType?: string;
}

export interface CreateEvidenceIntentResult {
  evidenceRef: string;
  uploadUrl: string;
  expiresAt: string;
}

interface ChallengeRow {
  id: string;
  creator_id: string;
  status: ChallengeStatus;
  submission_deadline: Date | null;
}

/**
 * Erzeugt eine Upload-Absicht für die In-App-Beweisaufnahme und legt den zugehörigen
 * EvidenceAsset (Status PENDING) an. Der zurückgegebene `evidenceRef` ist der einzige
 * Weg, später eine gültige Einsendung mit Beweis einzureichen — es gibt keinen Pfad,
 * der eine beliebige hochgeladene Datei akzeptiert (kein Galerieimport).
 *
 * Voraussetzungen wie beim Einreichen: Challenge nimmt Einsendungen an, Frist nicht
 * überschritten, Nutzer hält einen zählenden Slot, ist nicht der Ersteller und hat noch
 * keine Einsendung.
 */
export async function createEvidenceIntent(
  deps: CreateEvidenceIntentDeps,
  input: CreateEvidenceIntentInput,
): Promise<CreateEvidenceIntentResult> {
  const now = deps.now?.() ?? new Date();
  const { challengeId, userId } = input;

  const rows = await deps.prisma.$queryRaw<ChallengeRow[]>(Prisma.sql`
    SELECT id, creator_id, status, submission_deadline
    FROM challenges WHERE id = ${challengeId}::uuid
  `);
  const challenge = rows[0];
  if (challenge === undefined) {
    throw apiError('CHALLENGE_NOT_FOUND');
  }
  if (challenge.status !== 'OPEN' && challenge.status !== 'FULL') {
    throw apiError('CHALLENGE_INVALID_STATE');
  }
  if (challenge.submission_deadline !== null && now >= challenge.submission_deadline) {
    throw apiError('CHALLENGE_DEADLINE_PASSED');
  }
  if (challenge.creator_id === userId) {
    throw apiError('CREATOR_CANNOT_JOIN');
  }

  const slot = await deps.prisma.slot.findUnique({
    where: { challengeId_participantId: { challengeId, participantId: userId } },
  });
  if (slot === null || !COUNTING.includes(slot.status)) {
    throw apiError('NOT_A_PARTICIPANT');
  }

  const existing = await deps.prisma.submission.findUnique({
    where: { challengeId_participantId: { challengeId, participantId: userId } },
  });
  if (existing !== null) {
    throw apiError('ALREADY_SUBMITTED');
  }

  const target = await deps.storage.createUpload({
    challengeId,
    participantId: userId,
    contentType: input.contentType ?? 'video/webm',
  });

  const asset = await deps.prisma.evidenceAsset.create({
    data: {
      challengeId,
      participantId: userId,
      storageKey: target.storageKey,
      status: 'PENDING',
      capturedInApp: true,
    },
    select: { id: true },
  });

  return {
    evidenceRef: asset.id,
    uploadUrl: target.uploadUrl,
    expiresAt: target.expiresAt.toISOString(),
  };
}
