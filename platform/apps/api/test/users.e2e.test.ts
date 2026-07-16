import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AppErrorFilter } from '../src/common/app-error.filter.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { resetDb } from './reset-db.js';

/** Onboarding über HTTP: Registrierung (18+-Gate), Profil, und Selbst-Service-Join. */
let app: INestApplication;
let prisma: PrismaService;

function http() {
  return request(app.getHttpServer());
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ rawBody: true });
  app.useGlobalFilters(new AppErrorFilter());
  prisma = app.get(PrismaService);
  await app.init();
});
afterAll(async () => {
  await resetDb(prisma);
  await app.close();
});
beforeEach(async () => {
  await resetDb(prisma);
});

describe('POST /v1/users', () => {
  it('registriert einen volljährigen Nutzer (201)', async () => {
    const res = await http().post('/v1/users').send({ isAdult: true }).expect(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.isAdult).toBe(true);
  });

  it('lehnt Minderjährige ab (403)', async () => {
    const res = await http().post('/v1/users').send({ isAdult: false }).expect(403);
    expect(res.body.error.code).toBe('UNDERAGE');
  });

  it('liefert das eigene Profil und ermöglicht Self-Service (register → me → nutzbar)', async () => {
    const reg = await http().post('/v1/users').send({ isAdult: true }).expect(201);
    const id = reg.body.id as string;

    const me = await http().get('/v1/users/me').set('Authorization', `Bearer ${id}`).expect(200);
    expect(me.body.id).toBe(id);

    // Ohne Auth → 401.
    await http().get('/v1/users/me').expect(401);
  });
});
