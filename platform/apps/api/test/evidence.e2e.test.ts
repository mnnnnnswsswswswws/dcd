import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppErrorFilter } from '../src/common/app-error.filter.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { resetDb } from './reset-db.js';

/**
 * In-App-Aufnahme über HTTP mit aktiviertem Flag LONG_CAPTURE_ENABLED. Das Flag wird
 * beim Bootstrap gelesen, daher vor dem App-Import gesetzt und danach entfernt.
 */
let app: INestApplication;
let prisma: PrismaService;

function http() {
  return request(app.getHttpServer());
}

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
  await prisma.slot.create({ data: { challengeId: challenge.id, participantId: user.id, status: 'RESERVED' } });
  return { challengeId: challenge.id, userId: user.id };
}

beforeAll(async () => {
  process.env.LONG_CAPTURE_ENABLED = 'true';
  const { AppModule } = await import('../src/app.module.js');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ rawBody: true });
  app.useGlobalFilters(new AppErrorFilter());
  prisma = app.get(PrismaService);
  await app.init();
});
afterAll(async () => {
  await resetDb(prisma);
  await app.close();
  delete process.env.LONG_CAPTURE_ENABLED;
});
beforeEach(async () => {
  await resetDb(prisma);
});

describe('In-App-Aufnahme (aktiviert)', () => {
  it('GET /v1/config meldet longCaptureEnabled=true', async () => {
    const res = await http().get('/v1/config').expect(200);
    expect(res.body.longCaptureEnabled).toBe(true);
  });

  it('Intent → Einreichen mit Beweis-Ref (201)', async () => {
    const { challengeId, userId } = await seedParticipant();
    const intent = await http()
      .post(`/v1/challenges/${challengeId}/evidence-intent`)
      .set('Authorization', `Bearer ${userId}`)
      .send({ contentType: 'video/webm' })
      .expect(201);
    expect(intent.body.evidenceRef).toBeTruthy();
    expect(intent.body.uploadUrl).toContain('mock://upload/');

    const submitted = await http()
      .post(`/v1/challenges/${challengeId}/submit`)
      .set('Authorization', `Bearer ${userId}`)
      .send({ evidenceRef: intent.body.evidenceRef })
      .expect(201);
    expect(submitted.body).toMatchObject({ status: 'SUBMITTED' });
  });

  it('Einreichen ohne Beweis-Ref wird abgelehnt (400)', async () => {
    const { challengeId, userId } = await seedParticipant();
    await http()
      .post(`/v1/challenges/${challengeId}/submit`)
      .set('Authorization', `Bearer ${userId}`)
      .send({})
      .expect(400);
  });
});
