import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AppErrorFilter } from '../src/common/app-error.filter.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

/**
 * End-to-End-Test der HTTP-Schicht: bootstrappt die echte Nest-App und ruft die
 * Endpoints via HTTP auf. Voraussetzung: laufende PostgreSQL mit angewandtem Schema
 * und gesetztem DATABASE_URL.
 */
let app: INestApplication;
let prisma: PrismaService;

async function reset(): Promise<void> {
  await prisma.slot.deleteMany();
  await prisma.submission.deleteMany();
  await prisma.winnerDecision.deleteMany();
  await prisma.challenge.deleteMany();
  await prisma.user.deleteMany();
}

async function seed(status: 'OPEN' | 'FULL' = 'OPEN') {
  const creator = await prisma.user.create({ data: { isAdult: true } });
  const challenge = await prisma.challenge.create({
    data: {
      creatorId: creator.id,
      status,
      selectionMode: 'CREATOR_DECIDES',
      prizeAmountCents: 10_000,
      maxSlots: 10,
      submissionDeadline: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  return { creator, challenge };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalFilters(new AppErrorFilter());
  prisma = app.get(PrismaService);
  await app.init();
});

afterAll(async () => {
  await reset();
  await app.close();
});

beforeEach(async () => {
  await reset();
});

describe('POST /v1/challenges/:id/join', () => {
  it('reserviert einen Platz für den authentifizierten Nutzer (201)', async () => {
    const { challenge } = await seed('OPEN');
    const user = await prisma.user.create({ data: { isAdult: true } });

    const res = await request(app.getHttpServer())
      .post(`/v1/challenges/${challenge.id}/join`)
      .set('Authorization', `Bearer ${user.id}`)
      .expect(201);

    expect(res.body.slot.status).toBe('RESERVED');
    expect(res.body.slot.participantId).toBe(user.id);
    expect(res.body.challengeStatus).toBe('OPEN');
  });

  it('lehnt ohne Bearer-Token ab (401)', async () => {
    const { challenge } = await seed('OPEN');
    await request(app.getHttpServer()).post(`/v1/challenges/${challenge.id}/join`).expect(401);
  });

  it('lehnt den Ersteller ab (403, CREATOR_CANNOT_JOIN)', async () => {
    const { creator, challenge } = await seed('OPEN');
    const res = await request(app.getHttpServer())
      .post(`/v1/challenges/${challenge.id}/join`)
      .set('Authorization', `Bearer ${creator.id}`)
      .expect(403);
    expect(res.body.error.code).toBe('CREATOR_CANNOT_JOIN');
  });

  it('gibt 409 CHALLENGE_FULL zurück, sobald 10 Plätze belegt sind', async () => {
    const { challenge } = await seed('OPEN');
    const users = await Promise.all(
      Array.from({ length: 10 }, () => prisma.user.create({ data: { isAdult: true } })),
    );
    for (const u of users) {
      await request(app.getHttpServer())
        .post(`/v1/challenges/${challenge.id}/join`)
        .set('Authorization', `Bearer ${u.id}`)
        .expect(201);
    }

    const overflow = await prisma.user.create({ data: { isAdult: true } });
    const res = await request(app.getHttpServer())
      .post(`/v1/challenges/${challenge.id}/join`)
      .set('Authorization', `Bearer ${overflow.id}`)
      .expect(409);
    expect(res.body.error.code).toBe('CHALLENGE_FULL');
  });

  it('lehnt ein unbekanntes UUID-Format mit 400 ab', async () => {
    const user = await prisma.user.create({ data: { isAdult: true } });
    await request(app.getHttpServer())
      .post('/v1/challenges/not-a-uuid/join')
      .set('Authorization', `Bearer ${user.id}`)
      .expect(400);
  });
});

describe('GET /v1/challenges/:id', () => {
  it('liefert öffentlichen Zustand inkl. belegter Plätze', async () => {
    const { challenge } = await seed('OPEN');
    const user = await prisma.user.create({ data: { isAdult: true } });
    await request(app.getHttpServer())
      .post(`/v1/challenges/${challenge.id}/join`)
      .set('Authorization', `Bearer ${user.id}`)
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/v1/challenges/${challenge.id}`)
      .expect(200);
    expect(res.body.id).toBe(challenge.id);
    expect(res.body.occupiedSlots).toBe(1);
    expect(res.body).not.toHaveProperty('editToken');
  });

  it('gibt 404 für unbekannte Challenge', async () => {
    await request(app.getHttpServer())
      .get('/v1/challenges/00000000-0000-0000-0000-000000000000')
      .expect(404);
  });
});

describe('GET /health', () => {
  it('meldet ok und DB up', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', db: 'up' });
  });
});
