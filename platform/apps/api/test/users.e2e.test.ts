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

  it('listet erstellte und beigetretene Challenges', async () => {
    const creator = await prisma.user.create({ data: { isAdult: true } });
    const challenge = await prisma.challenge.create({
      data: { creatorId: creator.id, status: 'OPEN', selectionMode: 'CREATOR_DECIDES', prizeAmountCents: 10_000, maxSlots: 10 },
    });

    // Ersteller sieht die Challenge unter "created".
    const asCreator = await http().get('/v1/users/me/challenges').set('Authorization', `Bearer ${creator.id}`).expect(200);
    expect(asCreator.body.created.some((c: { id: string }) => c.id === challenge.id)).toBe(true);
    expect(asCreator.body.joined).toHaveLength(0);

    // Teilnehmer mit Slot sieht sie unter "joined" inkl. Slot-Status.
    const participant = await prisma.user.create({ data: { isAdult: true } });
    await prisma.slot.create({ data: { challengeId: challenge.id, participantId: participant.id, status: 'RESERVED' } });
    const asParticipant = await http().get('/v1/users/me/challenges').set('Authorization', `Bearer ${participant.id}`).expect(200);
    expect(asParticipant.body.joined).toHaveLength(1);
    expect(asParticipant.body.joined[0].slotStatus).toBe('RESERVED');
    expect(asParticipant.body.created).toHaveLength(0);

    await http().get('/v1/users/me/challenges').expect(401);
  });
});
