import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AppErrorFilter } from '../src/common/app-error.filter.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { resetDb } from './reset-db.js';

/** Benachrichtigungen abrufen + als gelesen markieren. */
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

describe('GET /v1/users/me/notifications', () => {
  it('listet Benachrichtigungen mit Ungelesen-Zähler und markiert sie als gelesen', async () => {
    const user = await prisma.user.create({ data: { isAdult: true } });
    await prisma.notification.createMany({
      data: [
        { userId: user.id, type: 'challenge.published', title: 'A', body: 'a' },
        { userId: user.id, type: 'submission.approved', title: 'B', body: 'b' },
      ],
    });

    const list = await http().get('/v1/users/me/notifications').set('Authorization', `Bearer ${user.id}`).expect(200);
    expect(list.body.unreadCount).toBe(2);
    expect(list.body.items).toHaveLength(2);

    const marked = await http().post('/v1/users/me/notifications/read').set('Authorization', `Bearer ${user.id}`).expect(200);
    expect(marked.body).toMatchObject({ marked: 2 });

    const after = await http().get('/v1/users/me/notifications').set('Authorization', `Bearer ${user.id}`).expect(200);
    expect(after.body.unreadCount).toBe(0);
    expect(after.body.items[0].read).toBe(true);
  });

  it('erfordert Authentifizierung (401)', async () => {
    await http().get('/v1/users/me/notifications').expect(401);
  });
});
