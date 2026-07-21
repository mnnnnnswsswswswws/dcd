import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '@vcp/contracts';
import { createEvidenceIntent } from '../src/submissions/create-evidence-intent.js';
import { submitEntry } from '../src/submissions/submit-entry.js';
import { MockEvidenceStorageProvider } from '../src/storage/mock-storage-provider.js';
import { InMemoryEventPublisher } from '../src/events/event-publisher.js';
import { resetDb } from './reset-db.js';

/**
 * In-App-Beweisaufnahme (Flag LONG_CAPTURE_ENABLED). Prüft: Intent erzeugt einen
 * PENDING-Asset, Einreichen bindet ihn (ATTACHED) und verlangt bei aktivierter Aufnahme
 * einen gültigen, zur Teilnahme gehörenden Ref. Voraussetzung: migrierte PostgreSQL.
 */
const prisma = new PrismaClient();
const storage = new MockEvidenceStorageProvider();

async function seedParticipant(): Promise<{ challengeId: string; userId: string }> {
  const creator = await prisma.user.create({ data: { isAdult: true } });
  const challenge = await prisma.challenge.create({
    data: {
      creatorId: creator.id,
      status: 'OPEN',
      selectionMode: 'CREATOR_DECIDES',
      prizeAmountCents: 10_000,
      maxSlots: 10,
      submissionDeadline: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  const user = await prisma.user.create({ data: { isAdult: true } });
  await prisma.slot.create({
    data: { challengeId: challenge.id, participantId: user.id, status: 'RESERVED' },
  });
  return { challengeId: challenge.id, userId: user.id };
}

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await resetDb(prisma);
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDb(prisma);
});

describe('In-App-Beweisaufnahme', () => {
  it('Intent → Einreichen bindet den Beweis an die Einsendung', async () => {
    const events = new InMemoryEventPublisher();
    const { challengeId, userId } = await seedParticipant();

    const intent = await createEvidenceIntent({ prisma, storage }, { challengeId, userId });
    expect(intent.evidenceRef).toBeTruthy();
    expect(intent.uploadUrl).toContain('mock://upload/');

    const pending = await prisma.evidenceAsset.findUnique({ where: { id: intent.evidenceRef } });
    expect(pending?.status).toBe('PENDING');
    expect(pending?.capturedInApp).toBe(true);

    const result = await submitEntry(
      { prisma, events },
      { challengeId, userId, evidenceRef: intent.evidenceRef, requireEvidence: true },
    );
    expect(result.status).toBe('SUBMITTED');

    const submission = await prisma.submission.findUnique({ where: { id: result.submissionId } });
    expect(submission?.evidenceRef).toBe(intent.evidenceRef);
    const attached = await prisma.evidenceAsset.findUnique({ where: { id: intent.evidenceRef } });
    expect(attached?.status).toBe('ATTACHED');
  });

  it('verlangt bei aktivierter Aufnahme einen Beweis (EVIDENCE_REQUIRED)', async () => {
    const events = new InMemoryEventPublisher();
    const { challengeId, userId } = await seedParticipant();

    await expect(
      submitEntry({ prisma, events }, { challengeId, userId, requireEvidence: true }),
    ).rejects.toMatchObject({ code: 'EVIDENCE_REQUIRED' } satisfies Partial<AppError>);
  });

  it('lehnt einen fremden/ungültigen Beweis-Ref ab (EVIDENCE_INVALID)', async () => {
    const events = new InMemoryEventPublisher();
    const a = await seedParticipant();
    const b = await seedParticipant();

    // Intent von Teilnehmer B, aber Einreichung durch Teilnehmer A.
    const intentB = await createEvidenceIntent({ prisma, storage }, { challengeId: b.challengeId, userId: b.userId });

    await expect(
      submitEntry(
        { prisma, events },
        { challengeId: a.challengeId, userId: a.userId, evidenceRef: intentB.evidenceRef, requireEvidence: true },
      ),
    ).rejects.toMatchObject({ code: 'EVIDENCE_INVALID' } satisfies Partial<AppError>);
  });

  it('bleibt ohne Flag der bisherige Stub (kein Ref nötig)', async () => {
    const events = new InMemoryEventPublisher();
    const { challengeId, userId } = await seedParticipant();

    const result = await submitEntry({ prisma, events }, { challengeId, userId });
    expect(result.status).toBe('SUBMITTED');
    const submission = await prisma.submission.findUnique({ where: { id: result.submissionId } });
    expect(submission?.evidenceRef).toBeNull();
  });
});
