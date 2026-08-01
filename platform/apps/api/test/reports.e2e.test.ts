import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AppErrorFilter } from '../src/common/app-error.filter.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { resetDb } from './reset-db.js';

/** Melden (Safety, Spec 14.5): erstellen + Admin-Queue. */
let app: INestApplication;
let prisma: PrismaService;
const ADMIN = `admin:${randomUUID()}`;

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

describe('POST /v1/reports', () => {
  it('erstellt eine Meldung mit abgeleiteter Priorität', async () => {
    const reporter = await prisma.user.create({ data: { isAdult: true } });
    const res = await http()
      .post('/v1/reports')
      .set('Authorization', `Bearer ${reporter.id}`)
      .send({ targetType: 'SUBMISSION', targetId: randomUUID(), reason: 'MINORS', description: 'unangemessen' })
      .expect(201);
    expect(res.body).toMatchObject({ status: 'OPEN', priority: 'HIGH' });
  });

  it('lehnt ungültigen Grund ab (400) und ohne Auth (401)', async () => {
    const reporter = await prisma.user.create({ data: { isAdult: true } });
    await http()
      .post('/v1/reports')
      .set('Authorization', `Bearer ${reporter.id}`)
      .send({ targetType: 'CHALLENGE', targetId: randomUUID(), reason: 'NOPE' })
      .expect(400);
    await http().post('/v1/reports').send({ targetType: 'CHALLENGE', targetId: randomUUID(), reason: 'SPAM' }).expect(401);
  });
});

describe('GET /v1/reports (Admin-Queue)', () => {
  it('nur für Admins; listet gemeldete Einträge nach Priorität', async () => {
    const reporter = await prisma.user.create({ data: { isAdult: true } });
    await http()
      .post('/v1/reports')
      .set('Authorization', `Bearer ${reporter.id}`)
      .send({ targetType: 'USER', targetId: randomUUID(), reason: 'FRAUD' })
      .expect(201);

    // Nicht-Admin → 403.
    await http().get('/v1/reports').set('Authorization', `Bearer ${reporter.id}`).expect(403);

    const res = await http().get('/v1/reports').set('Authorization', `Bearer ${ADMIN}`).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ reason: 'FRAUD', priority: 'MEDIUM', status: 'OPEN' });
  });
});

describe('PATCH /v1/reports/:id (Statuswechsel)', () => {
  it('Admin kann eine Meldung bearbeiten und schließen; Nicht-Admin 403', async () => {
    const reporter = await prisma.user.create({ data: { isAdult: true } });
    const created = await http()
      .post('/v1/reports')
      .set('Authorization', `Bearer ${reporter.id}`)
      .send({ targetType: 'SUBMISSION', targetId: randomUUID(), reason: 'SPAM' })
      .expect(201);
    const reportId: string = created.body.id;

    // Nicht-Admin darf nicht.
    await http()
      .patch(`/v1/reports/${reportId}`)
      .set('Authorization', `Bearer ${reporter.id}`)
      .send({ status: 'RESOLVED' })
      .expect(403);

    // Admin: OPEN → REVIEWING → RESOLVED.
    await http().patch(`/v1/reports/${reportId}`).set('Authorization', `Bearer ${ADMIN}`).send({ status: 'REVIEWING' }).expect(200);
    const done = await http().patch(`/v1/reports/${reportId}`).set('Authorization', `Bearer ${ADMIN}`).send({ status: 'RESOLVED' }).expect(200);
    expect(done.body).toMatchObject({ id: reportId, status: 'RESOLVED' });

    // RESOLVED ist terminal → weiterer Wechsel 409.
    await http().patch(`/v1/reports/${reportId}`).set('Authorization', `Bearer ${ADMIN}`).send({ status: 'DISMISSED' }).expect(409);

    // Queue zeigt die geschlossene Meldung nicht mehr unter OPEN.
    const open = await http().get('/v1/reports?status=OPEN').set('Authorization', `Bearer ${ADMIN}`).expect(200);
    expect(open.body).toHaveLength(0);
  });
});
