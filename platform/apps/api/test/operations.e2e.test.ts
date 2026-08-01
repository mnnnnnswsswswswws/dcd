import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppErrorFilter } from '../src/common/app-error.filter.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { OperationKind, createOperation } from '../src/operations/async-operations.js';
import { resetDb } from './reset-db.js';

/**
 * HTTP-Vertrag von `GET /v1/operations/:id` (Scale S1, Aufgabe 10).
 *
 * Der Endpunkt ist das Gegenstück zu `202 Accepted`. Drei Zusagen werden hier
 * geprüft: Authentifizierung ist Pflicht, die eigene Operation ist lesbar, und eine
 * fremde Operation ist von einer nicht existierenden nicht zu unterscheiden.
 */
let app: INestApplication;
let prisma: PrismaService;

function http() {
  return request(app.getHttpServer());
}

beforeAll(async () => {
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
});
beforeEach(async () => {
  await resetDb(prisma);
});

describe('GET /v1/operations/:id', () => {
  it('verlangt Authentifizierung', async () => {
    const op = await createOperation(prisma, { kind: OperationKind.VIDEO_PROCESSING });
    await http().get(`/v1/operations/${op.id}`).expect(401);
  });

  it('liefert den Status der eigenen Operation', async () => {
    const user = await prisma.user.create({ data: { isAdult: true } });
    const op = await createOperation(prisma, {
      kind: OperationKind.VIDEO_PROCESSING,
      ownerUserId: user.id,
      resourceType: 'submission',
      resourceId: 'sub-1',
    });

    const res = await http()
      .get(`/v1/operations/${op.id}`)
      .set('Authorization', `Bearer ${user.id}`)
      .expect(200);

    expect(res.body.id).toBe(op.id);
    expect(res.body.status).toBe('PENDING');
    expect(res.body.kind).toBe('VIDEO_PROCESSING');
    expect(res.body.resourceId).toBe('sub-1');
  });

  it('gibt eine fremde Operation nicht heraus', async () => {
    const owner = await prisma.user.create({ data: { isAdult: true } });
    const other = await prisma.user.create({ data: { isAdult: true } });
    const op = await createOperation(prisma, {
      kind: OperationKind.VIDEO_PROCESSING,
      ownerUserId: owner.id,
    });

    // 404 statt 403: Der Endpunkt verrät nicht, dass es die Operation gibt.
    await http()
      .get(`/v1/operations/${op.id}`)
      .set('Authorization', `Bearer ${other.id}`)
      .expect(404);
  });

  it('antwortet 404 für eine unbekannte ID', async () => {
    const user = await prisma.user.create({ data: { isAdult: true } });
    await http()
      .get('/v1/operations/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${user.id}`)
      .expect(404);
  });

  it('weist eine unsauber formatierte ID ab', async () => {
    const user = await prisma.user.create({ data: { isAdult: true } });
    await http()
      .get('/v1/operations/keine-uuid')
      .set('Authorization', `Bearer ${user.id}`)
      .expect(400);
  });
});
