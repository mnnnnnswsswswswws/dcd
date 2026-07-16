import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppErrorFilter } from '../src/common/app-error.filter.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { resetDb } from './reset-db.js';

/**
 * Öffentlicher Feed — hier mit aktiviertem Flag getestet. Das Flag wird beim
 * Bootstrap gelesen, daher wird es in beforeAll vor der App-Erstellung gesetzt und
 * in afterAll wieder entfernt, um andere Test-Dateien nicht zu beeinflussen.
 */
let app: INestApplication;
let prisma: PrismaService;

async function seedDecided(): Promise<string> {
  const creator = await prisma.user.create({ data: { isAdult: true } });
  const challenge = await prisma.challenge.create({
    data: {
      creatorId: creator.id,
      status: 'WINNER_LOCKED',
      selectionMode: 'CREATOR_DECIDES',
      prizeAmountCents: 10_000,
      maxSlots: 10,
    },
  });
  await prisma.winnerDecision.create({
    data: { challengeId: challenge.id, decisionSource: 'CREATOR', winnerSubmissionId: null },
  });
  return challenge.id;
}

beforeAll(async () => {
  process.env.PUBLIC_FEED_ENABLED = 'true';
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
  delete process.env.PUBLIC_FEED_ENABLED;
});
beforeEach(async () => {
  await resetDb(prisma);
});

describe('GET /v1/feed (aktiviert)', () => {
  it('liefert entschiedene Challenges mit Gewinner-Info', async () => {
    const challengeId = await seedDecided();
    const res = await request(app.getHttpServer()).get('/v1/feed').expect(200);
    const entry = res.body.find((e: { id: string }) => e.id === challengeId);
    expect(entry).toBeTruthy();
    expect(entry.winner.decisionSource).toBe('CREATOR');
  });

  it('zeigt nicht-entschiedene Challenges nicht', async () => {
    const creator = await prisma.user.create({ data: { isAdult: true } });
    const open = await prisma.challenge.create({
      data: { creatorId: creator.id, status: 'OPEN', selectionMode: 'CREATOR_DECIDES', prizeAmountCents: 5_000, maxSlots: 10 },
    });
    const res = await request(app.getHttpServer()).get('/v1/feed').expect(200);
    expect(res.body.some((e: { id: string }) => e.id === open.id)).toBe(false);
  });
});
