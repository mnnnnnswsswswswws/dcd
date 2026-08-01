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

/** Öffentliche Profile: setzen (PATCH /v1/users/me) + abrufen (GET /v1/profiles/:username). */
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

describe('Profile', () => {
  it('setzt Nutzername/Anzeigename/Bio und liefert das öffentliche Profil', async () => {
    const user = await prisma.user.create({ data: { isAdult: true } });
    const patched = await http()
      .patch('/v1/users/me')
      .set('Authorization', `Bearer ${user.id}`)
      .send({ username: 'AceMaker', displayName: 'Ace', bio: 'Ich mache Trickshots.' })
      .expect(200);
    expect(patched.body).toMatchObject({ username: 'acemaker', displayName: 'Ace' });

    const profile = await http().get('/v1/profiles/acemaker').expect(200);
    expect(profile.body).toMatchObject({
      username: 'acemaker',
      displayName: 'Ace',
      bio: 'Ich mache Trickshots.',
      createdCount: 0,
      wonCount: 0,
    });
  });

  it('lehnt einen bereits vergebenen Nutzernamen ab (409)', async () => {
    const a = await prisma.user.create({ data: { isAdult: true } });
    const b = await prisma.user.create({ data: { isAdult: true } });
    await http().patch('/v1/users/me').set('Authorization', `Bearer ${a.id}`).send({ username: 'taken' }).expect(200);
    await http().patch('/v1/users/me').set('Authorization', `Bearer ${b.id}`).send({ username: 'TAKEN' }).expect(409);
  });

  it('lehnt ungültige Nutzernamen ab (400) und reservierte Wörter (409)', async () => {
    const user = await prisma.user.create({ data: { isAdult: true } });
    await http().patch('/v1/users/me').set('Authorization', `Bearer ${user.id}`).send({ username: 'a' }).expect(400);
    await http().patch('/v1/users/me').set('Authorization', `Bearer ${user.id}`).send({ username: 'admin' }).expect(409);
  });

  it('unbekanntes Profil → 404', async () => {
    await http().get(`/v1/profiles/${randomUUID().slice(0, 10)}`).expect(404);
  });
});
