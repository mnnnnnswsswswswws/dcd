import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { AppErrorFilter } from '../src/common/app-error.filter.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { resetDb } from './reset-db.js';

/**
 * App-Check mit aktiviertem Flag (Mock-Verifier). Flag wird vor dem App-Import gesetzt.
 * App-Requests brauchen dann den Header `x-firebase-appcheck`; Webhooks/Health/Config nicht.
 */
let app: INestApplication;
let prisma: PrismaService;

function http() {
  return request(app.getHttpServer());
}

beforeAll(async () => {
  process.env.APP_CHECK_ENABLED = 'true';
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
  delete process.env.APP_CHECK_ENABLED;
});
beforeEach(async () => {
  await resetDb(prisma);
});

describe('App-Check (aktiviert)', () => {
  it('App-Request ohne App-Check-Header → 401', async () => {
    await http().get('/v1/challenges').expect(401);
  });

  it('App-Request mit gültigem App-Check-Header → erlaubt', async () => {
    await http().get('/v1/challenges').set('X-Firebase-AppCheck', 'valid-token').expect(200);
  });

  it('Health und Config sind ausgenommen (kein Header nötig)', async () => {
    await http().get('/health').expect(200);
    await http().get('/v1/config').expect(200);
  });
});
