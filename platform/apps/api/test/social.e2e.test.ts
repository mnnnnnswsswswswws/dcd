import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AppErrorFilter } from '../src/common/app-error.filter.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { resetDb } from './reset-db.js';

/** Social-Endpunkte über HTTP: Like, Bookmark, Kommentar, eigene Listen. */
let app: INestApplication;
let prisma: PrismaService;

function http() {
  return request(app.getHttpServer());
}

async function seedChallenge(): Promise<string> {
  const creator = await prisma.user.create({ data: { isAdult: true } });
  const c = await prisma.challenge.create({
    data: { creatorId: creator.id, status: 'OPEN', selectionMode: 'COMMUNITY_VOTE', prizeAmountCents: 5000, maxSlots: 10 },
  });
  return c.id;
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

describe('Social-Endpunkte', () => {
  it('Like/Bookmark togglen und in /me/likes bzw. /me/bookmarks spiegeln', async () => {
    const cid = await seedChallenge();
    const user = await prisma.user.create({ data: { isAdult: true } });
    const auth = `Bearer ${user.id}`;

    const liked = await http().post(`/v1/challenges/${cid}/like`).set('Authorization', auth).expect(200);
    expect(liked.body).toEqual({ liked: true, likeCount: 1 });
    await http().post(`/v1/challenges/${cid}/bookmark`).set('Authorization', auth).expect(200);

    const likes = await http().get('/v1/users/me/likes').set('Authorization', auth).expect(200);
    expect(likes.body).toEqual([cid]);
    const marks = await http().get('/v1/users/me/bookmarks').set('Authorization', auth).expect(200);
    expect(marks.body).toEqual([cid]);

    // Liste trägt echte Zähler.
    const list = await http().get('/v1/challenges?status=OPEN').expect(200);
    const row = list.body.find((r: { id: string }) => r.id === cid);
    expect(row.likeCount).toBe(1);
  });

  it('Kommentar posten (201), öffentlich lesen (200), Autor-Handle', async () => {
    const cid = await seedChallenge();
    const user = await prisma.user.create({ data: { isAdult: true, username: 'skater_lena' } });
    await http()
      .post(`/v1/challenges/${cid}/comments`)
      .set('Authorization', `Bearer ${user.id}`)
      .send({ body: 'Respekt!' })
      .expect(201);

    const res = await http().get(`/v1/challenges/${cid}/comments`).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ body: 'Respekt!', author: 'skater_lena' });
  });

  it('leerer Kommentar → 400, ohne Auth → 401', async () => {
    const cid = await seedChallenge();
    const user = await prisma.user.create({ data: { isAdult: true } });
    await http().post(`/v1/challenges/${cid}/comments`).set('Authorization', `Bearer ${user.id}`).send({ body: '  ' }).expect(400);
    await http().post(`/v1/challenges/${cid}/comments`).send({ body: 'hi' }).expect(401);
    await http().post(`/v1/challenges/${cid}/like`).expect(401);
  });
});
