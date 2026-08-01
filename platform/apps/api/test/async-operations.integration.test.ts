import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  OperationKind,
  TransitionOutcome,
  createOperation,
  getOperation,
  markFailed,
  markRunning,
  markSucceeded,
  purgeExpiredOperations,
} from '../src/operations/async-operations.js';
import { MockEvidenceStorageProvider } from '../src/storage/mock-storage-provider.js';
import { resetDb } from './reset-db.js';

/**
 * Asynchrone Operationen (Aufgabe 10) und direkte Uploads (Aufgabe 11).
 *
 * Der Kern beider Aufgaben ist derselbe: Lange Arbeit und grosse Bytes gehören
 * nicht in den Request-Pfad. Die Tests prüfen das an den beiden Stellen, an denen
 * es sonst schleichend kaputtgeht — Zustandsübergänge unter Mehrfachzustellung und
 * die Frage, ob Videodaten je den API-Prozess berühren.
 */
const prisma = new PrismaClient();

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDb(prisma);
});

describe('Asynchrone Operationen: Lebenszyklus', () => {
  it('startet als PENDING mit 0 % Fortschritt', async () => {
    const op = await createOperation(prisma, { kind: OperationKind.VIDEO_PROCESSING });
    expect(op.status).toBe('PENDING');
    expect(op.progress).toBe(0);
    expect(op.error).toBeNull();
  });

  it('durchläuft PENDING → RUNNING → SUCCEEDED', async () => {
    const op = await createOperation(prisma, { kind: OperationKind.VIDEO_PROCESSING });
    expect(await markRunning(prisma, op.id, 40)).toBe(TransitionOutcome.APPLIED);
    expect((await getOperation(prisma, op.id))?.progress).toBe(40);

    expect(await markSucceeded(prisma, op.id, { playbackUrl: 'x' })).toBe(TransitionOutcome.APPLIED);
    const done = await getOperation(prisma, op.id);
    expect(done?.status).toBe('SUCCEEDED');
    expect(done?.progress).toBe(100);
    expect(done?.result).toEqual({ playbackUrl: 'x' });
  });

  it('hält einen terminalen Zustand fest — Mehrfachzustellung bleibt folgenlos', async () => {
    const op = await createOperation(prisma, { kind: OperationKind.VIDEO_PROCESSING });
    await markSucceeded(prisma, op.id, { first: true });

    // Der Worker stellt erneut zu (at-least-once).
    expect(await markSucceeded(prisma, op.id, { second: true })).toBe(
      TransitionOutcome.ALREADY_TERMINAL,
    );
    expect(await markFailed(prisma, op.id, 'X', 'y')).toBe(TransitionOutcome.ALREADY_TERMINAL);
    expect(await markRunning(prisma, op.id, 10)).toBe(TransitionOutcome.ALREADY_TERMINAL);

    const still = await getOperation(prisma, op.id);
    expect(still?.status).toBe('SUCCEEDED');
    expect(still?.result).toEqual({ first: true });
  });

  it('lässt Fortschritt nicht rückwärts springen', async () => {
    const op = await createOperation(prisma, { kind: OperationKind.VIDEO_PROCESSING });
    await markRunning(prisma, op.id, 80);
    // Verspätete ältere Nachricht mit kleinerem Fortschritt.
    await markRunning(prisma, op.id, 20);
    expect((await getOperation(prisma, op.id))?.progress).toBe(80);
  });

  it('begrenzt Fortschritt auf 0..100', async () => {
    const op = await createOperation(prisma, { kind: OperationKind.VIDEO_PROCESSING });
    await markRunning(prisma, op.id, 500);
    expect((await getOperation(prisma, op.id))?.progress).toBe(100);
  });

  it('hält den Fehler mit Code und Meldung fest', async () => {
    const op = await createOperation(prisma, { kind: OperationKind.VIDEO_PROCESSING });
    await markFailed(prisma, op.id, 'TRANSCODE_FAILED', 'Codec nicht unterstützt');
    const failed = await getOperation(prisma, op.id);
    expect(failed?.status).toBe('FAILED');
    expect(failed?.error).toEqual({
      code: 'TRANSCODE_FAILED',
      message: 'Codec nicht unterstützt',
    });
  });

  it('meldet NOT_FOUND für eine unbekannte ID', async () => {
    expect(await markRunning(prisma, '00000000-0000-0000-0000-000000000000')).toBe(
      TransitionOutcome.NOT_FOUND,
    );
  });
});

describe('Asynchrone Operationen: Zugriffsschutz', () => {
  it('gibt eine fremde Operation nicht heraus', async () => {
    const owner = await prisma.user.create({ data: { isAdult: true } });
    const other = await prisma.user.create({ data: { isAdult: true } });
    const op = await createOperation(prisma, {
      kind: OperationKind.VIDEO_PROCESSING,
      ownerUserId: owner.id,
    });

    expect(await getOperation(prisma, op.id, owner.id)).not.toBeNull();
    // Fremd und nicht existent sind ununterscheidbar — keine Existenzauskunft.
    expect(await getOperation(prisma, op.id, other.id)).toBeNull();
  });

  it('lässt Operationen ohne Besitzer für alle lesbar', async () => {
    const op = await createOperation(prisma, { kind: OperationKind.PROJECTION_REBUILD });
    const anyone = await prisma.user.create({ data: { isAdult: true } });
    expect(await getOperation(prisma, op.id, anyone.id)).not.toBeNull();
  });
});

describe('Asynchrone Operationen: Retention', () => {
  it('räumt abgelaufene Operationen ab und lässt frische stehen', async () => {
    const fresh = await createOperation(prisma, { kind: OperationKind.VIDEO_PROCESSING });
    const old = await createOperation(prisma, { kind: OperationKind.VIDEO_PROCESSING });
    await prisma.asyncOperation.update({
      where: { id: old.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    expect(await purgeExpiredOperations(prisma)).toBe(1);
    expect(await getOperation(prisma, old.id)).toBeNull();
    expect(await getOperation(prisma, fresh.id)).not.toBeNull();
  });
});

describe('Regel: keine Videobytes durch den API-Prozess (Aufgabe 11)', () => {
  it('liefert eine direkte Upload-URL statt einen Upload-Endpunkt anzubieten', async () => {
    const target = await new MockEvidenceStorageProvider().createUpload({
      challengeId: '11111111-1111-1111-1111-111111111111',
      participantId: '22222222-2222-2222-2222-222222222222',
      contentType: 'video/mp4',
    });

    // Der Client lädt gegen den Storage hoch, nicht gegen die API.
    expect(target.uploadUrl).toBeTruthy();
    expect(target.storageKey).toContain('evidence/');
    expect(target.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('bietet keinen API-Pfad an, der Videodaten entgegennimmt', async () => {
    // Strukturprüfung: Kein Controller im Repo nimmt einen Video-Body entgegen.
    // Bytes fließen ausschließlich per presignter URL direkt in den Storage.
    const { readFileSync, readdirSync } = await import('node:fs');
    const { join } = await import('node:path');

    const srcDir = new URL('../src', import.meta.url).pathname;
    const controllers: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.name.endsWith('.controller.ts')) controllers.push(p);
      }
    };
    walk(srcDir);
    expect(controllers.length).toBeGreaterThan(0);

    for (const file of controllers) {
      const content = readFileSync(file, 'utf8');
      // Multipart-/Datei-Upload-Dekoratoren sind in dieser Architektur unzulässig.
      expect(content, `${file} darf keinen Datei-Upload annehmen`).not.toMatch(
        /@UploadedFile|FileInterceptor|multipart\/form-data/,
      );
    }
  });
});
