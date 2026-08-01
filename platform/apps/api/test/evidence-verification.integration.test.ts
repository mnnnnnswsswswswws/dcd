import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MockEvidenceStorageProvider } from '../src/storage/mock-storage-provider.js';
import { EvidenceError, processEvidenceOperations } from '../src/operations/process-evidence.js';
import { getOperation } from '../src/operations/async-operations.js';
import { joinChallenge } from '../src/challenges/join-challenge.js';
import { submitEntry } from '../src/submissions/submit-entry.js';
import { InMemoryEventPublisher } from '../src/events/event-publisher.js';
import { resetDb } from './reset-db.js';

/**
 * Beweisprüfung hinter `202 Accepted`.
 *
 * Der Fall, für den das gebaut ist: Ein Client holt sich eine signierte Upload-URL,
 * lädt aber nie hoch und reicht trotzdem ein. Bis hierher wäre das erst bei der
 * Gewinnerauswahl aufgefallen — niemand hat je nachgesehen, ob Bytes ankamen.
 */
const prisma = new PrismaClient();
const events = new InMemoryEventPublisher();

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDb(prisma);
});

/** Legt Challenge, Teilnehmer und ein Evidence-Asset an und reicht ein. */
async function einreichenMitBeweis(): Promise<{
  submissionId: string;
  operationId: string;
  storageKey: string;
}> {
  const creator = await prisma.user.create({ data: { isAdult: true } });
  const teilnehmer = await prisma.user.create({ data: { isAdult: true } });
  const challenge = await prisma.challenge.create({
    data: {
      creatorId: creator.id,
      title: 'Beweisprüfung',
      status: 'OPEN',
      maxSlots: 10,
      prizeAmountCents: 1000,
      selectionMode: 'CREATOR_DECIDES',
    },
  });
  await joinChallenge({ prisma, events }, { challengeId: challenge.id, userId: teilnehmer.id });

  const storageKey = `evidence/${challenge.id}/${teilnehmer.id}/${crypto.randomUUID()}`;
  const asset = await prisma.evidenceAsset.create({
    data: {
      challengeId: challenge.id,
      participantId: teilnehmer.id,
      storageKey,
      status: 'PENDING',
    },
  });

  const result = await submitEntry(
    { prisma, events },
    { challengeId: challenge.id, userId: teilnehmer.id, evidenceRef: asset.id },
  );

  expect(result.operationId, 'Ohne Operation gäbe es nichts zu verfolgen').toBeDefined();
  return { submissionId: result.submissionId, operationId: result.operationId as string, storageKey };
}

describe('Operation entsteht mit der Einsendung', () => {
  it('legt sie im selben Commit an', async () => {
    const { submissionId, operationId } = await einreichenMitBeweis();
    const op = await getOperation(prisma, operationId);
    expect(op?.status).toBe('PENDING');
    expect(op?.kind).toBe('VIDEO_PROCESSING');
    expect(op?.resourceType).toBe('submission');
    expect(op?.resourceId).toBe(submissionId);
  });

  it('legt ohne Beweisvideo keine Operation an', async () => {
    // Ohne asynchrone Arbeit gibt es nichts zu verfolgen — eine Operation, die
    // sofort auf SUCCEEDED stünde, wäre nur Rauschen.
    const creator = await prisma.user.create({ data: { isAdult: true } });
    const teilnehmer = await prisma.user.create({ data: { isAdult: true } });
    const challenge = await prisma.challenge.create({
      data: {
        creatorId: creator.id,
        title: 'Ohne Beweis',
        status: 'OPEN',
        maxSlots: 10,
        prizeAmountCents: 1000,
        selectionMode: 'CREATOR_DECIDES',
      },
    });
    await joinChallenge({ prisma, events }, { challengeId: challenge.id, userId: teilnehmer.id });

    const result = await submitEntry(
      { prisma, events },
      { challengeId: challenge.id, userId: teilnehmer.id },
    );
    expect(result.operationId).toBeUndefined();
    expect(await prisma.asyncOperation.count()).toBe(0);
  });
});

describe('Prüfung des hochgeladenen Objekts', () => {
  it('schließt die Operation ab, wenn das Objekt existiert', async () => {
    const { operationId, storageKey } = await einreichenMitBeweis();
    const storage = new MockEvidenceStorageProvider();
    storage.putForTest(storageKey, { sizeBytes: 2_400_000, contentType: 'video/mp4' });

    const stats = await processEvidenceOperations(prisma, storage);
    expect(stats).toMatchObject({ claimed: 1, succeeded: 1, failed: 0 });

    const op = await getOperation(prisma, operationId);
    expect(op?.status).toBe('SUCCEEDED');
    expect(op?.progress).toBe(100);
    expect(op?.result).toMatchObject({ sizeBytes: 2_400_000, contentType: 'video/mp4' });
  });

  it('erkennt eine Einsendung, deren Video nie hochgeladen wurde', async () => {
    // Genau der Betrugsfall: Upload-URL geholt, nichts hochgeladen, eingereicht.
    const { operationId } = await einreichenMitBeweis();
    const storage = new MockEvidenceStorageProvider(); // nichts abgelegt

    const stats = await processEvidenceOperations(prisma, storage);
    expect(stats).toMatchObject({ claimed: 1, succeeded: 0, failed: 1 });

    const op = await getOperation(prisma, operationId);
    expect(op?.status).toBe('FAILED');
    expect(op?.error?.code).toBe(EvidenceError.OBJECT_MISSING);
  });

  it('lässt ein leeres Objekt nicht als Beweis durchgehen', async () => {
    const { operationId, storageKey } = await einreichenMitBeweis();
    const storage = new MockEvidenceStorageProvider();
    storage.putForTest(storageKey, { sizeBytes: 0, contentType: 'video/mp4' });

    await processEvidenceOperations(prisma, storage);
    const op = await getOperation(prisma, operationId);
    expect(op?.error?.code).toBe(EvidenceError.OBJECT_EMPTY);
  });

  it('verschiebt bei einer Storage-Störung, statt den Beweis zu verwerfen', async () => {
    // Ein Netzwerkfehler ist kein fehlendes Video. Würde er als Fehlschlag zählen,
    // verlöre eine gültige Einsendung ihren Beweis wegen einer Störung.
    const { operationId, storageKey } = await einreichenMitBeweis();
    const kaputt = new MockEvidenceStorageProvider();
    kaputt.statObject = async () => {
      throw new Error('ECONNRESET');
    };

    const stats = await processEvidenceOperations(prisma, kaputt);
    expect(stats).toMatchObject({ claimed: 1, succeeded: 0, failed: 0 });

    const op = await getOperation(prisma, operationId);
    expect(op?.status).toBe('RUNNING');

    // Nach Ablauf der Sichtbarkeit greift der nächste Lauf sie erneut — und mit
    // erreichbarem Storage kommt sie dann durch.
    const heil = new MockEvidenceStorageProvider();
    heil.putForTest(storageKey);
    const spaeter = new Date(Date.now() + 10 * 60 * 1000);
    const zweiter = await processEvidenceOperations(prisma, heil, 20, spaeter);
    expect(zweiter).toMatchObject({ claimed: 1, succeeded: 1 });
    expect((await getOperation(prisma, operationId))?.status).toBe('SUCCEEDED');
  });

  it('greift eine bereits abgeschlossene Operation nicht erneut', async () => {
    const { storageKey } = await einreichenMitBeweis();
    const storage = new MockEvidenceStorageProvider();
    storage.putForTest(storageKey);

    await processEvidenceOperations(prisma, storage);
    const zweiter = await processEvidenceOperations(prisma, storage);
    expect(zweiter.claimed).toBe(0);
  });

  it('arbeitet einen Rückstand über mehrere Durchläufe ab', async () => {
    const keys: string[] = [];
    for (let i = 0; i < 5; i += 1) keys.push((await einreichenMitBeweis()).storageKey);

    const storage = new MockEvidenceStorageProvider();
    for (const k of keys) storage.putForTest(k);

    expect((await processEvidenceOperations(prisma, storage, 2)).claimed).toBe(2);
    expect((await processEvidenceOperations(prisma, storage, 2)).claimed).toBe(2);
    expect((await processEvidenceOperations(prisma, storage, 2)).claimed).toBe(1);
    expect((await processEvidenceOperations(prisma, storage, 2)).claimed).toBe(0);
  });

  it('greift dieselbe Operation bei parallelen Workern nur einmal', async () => {
    // FOR UPDATE SKIP LOCKED — dieselbe Absicherung wie beim Outbox-Publisher.
    const keys: string[] = [];
    for (let i = 0; i < 6; i += 1) keys.push((await einreichenMitBeweis()).storageKey);
    const storage = new MockEvidenceStorageProvider();
    for (const k of keys) storage.putForTest(k);

    const [a, b] = await Promise.all([
      processEvidenceOperations(prisma, storage, 10),
      processEvidenceOperations(prisma, storage, 10),
    ]);
    expect(a.claimed + b.claimed).toBe(6);
    expect(await prisma.asyncOperation.count({ where: { status: 'SUCCEEDED' } })).toBe(6);
  });
});
