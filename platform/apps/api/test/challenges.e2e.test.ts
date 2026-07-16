import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AppErrorFilter } from '../src/common/app-error.filter.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { resetDb } from './reset-db.js';

/**
 * End-to-End-Test der HTTP-Schicht: bootstrappt die echte Nest-App und ruft die
 * Endpoints via HTTP auf. Voraussetzung: laufende PostgreSQL mit angewandtem Schema
 * und gesetztem DATABASE_URL.
 */
let app: INestApplication;
let prisma: PrismaService;

async function reset(): Promise<void> {
  await resetDb(prisma);
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
  app = moduleRef.createNestApplication({ rawBody: true });
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

describe('Lebenszyklus über HTTP: erstellen → Webhook → beitreten', () => {
  const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? 'dev-webhook-secret';

  it('erstellt, veröffentlicht per Webhook und erlaubt dann den Beitritt', async () => {
    const creator = await prisma.user.create({ data: { isAdult: true } });

    // 1. Challenge erstellen (PENDING_FUNDING) + Finanzierungs-Absicht.
    const createRes = await request(app.getHttpServer())
      .post('/v1/challenges')
      .set('Authorization', `Bearer ${creator.id}`)
      .send({
        selectionMode: 'CREATOR_DECIDES',
        prizeAmountCents: 10_000,
        submissionDeadline: new Date(Date.now() + 3_600_000).toISOString(),
      })
      .expect(201);
    expect(createRes.body.challenge.status).toBe('PENDING_FUNDING');
    const challengeId = createRes.body.challenge.id as string;
    const providerRef = createRes.body.funding.providerRef as string;

    // 2. Beitritt vor Finanzierung scheitert.
    const participant = await prisma.user.create({ data: { isAdult: true } });
    await request(app.getHttpServer())
      .post(`/v1/challenges/${challengeId}/join`)
      .set('Authorization', `Bearer ${participant.id}`)
      .expect(409);

    // 3. Webhook mit falschem Secret → 401.
    await request(app.getHttpServer())
      .post('/v1/webhooks/payments')
      .set('x-webhook-secret', 'falsch')
      .send({ type: 'funding.succeeded', providerRef, amountCents: 10_000 })
      .expect(401);

    // 4. Korrekter Webhook → Veröffentlichung.
    const hook = await request(app.getHttpServer())
      .post('/v1/webhooks/payments')
      .set('x-webhook-secret', WEBHOOK_SECRET)
      .send({ type: 'funding.succeeded', providerRef, amountCents: 10_000 })
      .expect(200);
    expect(hook.body).toMatchObject({ received: true, published: true });

    // 5. Erneuter Webhook ist idempotent.
    const again = await request(app.getHttpServer())
      .post('/v1/webhooks/payments')
      .set('x-webhook-secret', WEBHOOK_SECRET)
      .send({ type: 'funding.succeeded', providerRef, amountCents: 10_000 })
      .expect(200);
    expect(again.body).toMatchObject({ received: true, published: false, alreadyConfirmed: true });

    // 6. Jetzt ist der Beitritt möglich.
    await request(app.getHttpServer())
      .post(`/v1/challenges/${challengeId}/join`)
      .set('Authorization', `Bearer ${participant.id}`)
      .expect(201);
  });

  it('lehnt ungültige Eingaben beim Erstellen ab (400)', async () => {
    const creator = await prisma.user.create({ data: { isAdult: true } });
    await request(app.getHttpServer())
      .post('/v1/challenges')
      .set('Authorization', `Bearer ${creator.id}`)
      .send({ selectionMode: 'CREATOR_DECIDES', prizeAmountCents: -1, submissionDeadline: new Date(Date.now() + 3_600_000).toISOString() })
      .expect(400);
  });
});

describe('POST /v1/challenges/:id/cancel', () => {
  it('bricht ab (Ersteller), danach kein Beitritt mehr', async () => {
    const creator = await prisma.user.create({ data: { isAdult: true } });
    const create = await request(app.getHttpServer())
      .post('/v1/challenges')
      .set('Authorization', `Bearer ${creator.id}`)
      .send({ selectionMode: 'CREATOR_DECIDES', prizeAmountCents: 10_000, submissionDeadline: new Date(Date.now() + 3_600_000).toISOString() })
      .expect(201);
    const challengeId = create.body.challenge.id as string;

    const cancel = await request(app.getHttpServer())
      .post(`/v1/challenges/${challengeId}/cancel`)
      .set('Authorization', `Bearer ${creator.id}`)
      .expect(200);
    expect(cancel.body).toMatchObject({ status: 'CANCELLED' });

    const outsider = await prisma.user.create({ data: { isAdult: true } });
    await request(app.getHttpServer())
      .post(`/v1/challenges/${challengeId}/join`)
      .set('Authorization', `Bearer ${outsider.id}`)
      .expect(409);
  });

  it('lehnt Abbruch durch Fremde ab (403)', async () => {
    const creator = await prisma.user.create({ data: { isAdult: true } });
    const create = await request(app.getHttpServer())
      .post('/v1/challenges')
      .set('Authorization', `Bearer ${creator.id}`)
      .send({ selectionMode: 'CREATOR_DECIDES', prizeAmountCents: 10_000, submissionDeadline: new Date(Date.now() + 3_600_000).toISOString() })
      .expect(201);
    const stranger = await prisma.user.create({ data: { isAdult: true } });
    const res = await request(app.getHttpServer())
      .post(`/v1/challenges/${create.body.challenge.id}/cancel`)
      .set('Authorization', `Bearer ${stranger.id}`)
      .expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

describe('Read-Endpoints (Discover/Admin)', () => {
  it('listet Challenges und filtert nach Status', async () => {
    const creator = await prisma.user.create({ data: { isAdult: true } });
    const create = await request(app.getHttpServer())
      .post('/v1/challenges')
      .set('Authorization', `Bearer ${creator.id}`)
      .send({ selectionMode: 'CREATOR_DECIDES', prizeAmountCents: 10_000, submissionDeadline: new Date(Date.now() + 3_600_000).toISOString() })
      .expect(201);
    const id = create.body.challenge.id as string;

    const all = await request(app.getHttpServer()).get('/v1/challenges').expect(200);
    expect(all.body.some((c: { id: string }) => c.id === id)).toBe(true);

    const filtered = await request(app.getHttpServer()).get('/v1/challenges?status=PENDING_FUNDING').expect(200);
    expect(filtered.body.every((c: { status: string }) => c.status === 'PENDING_FUNDING')).toBe(true);

    await request(app.getHttpServer()).get('/v1/challenges?status=NOPE').expect(400);
  });

  it('liefert Einsendungen einer Challenge (Auth erforderlich)', async () => {
    const creator = await prisma.user.create({ data: { isAdult: true } });
    const create = await request(app.getHttpServer())
      .post('/v1/challenges')
      .set('Authorization', `Bearer ${creator.id}`)
      .send({ selectionMode: 'CREATOR_DECIDES', prizeAmountCents: 10_000, submissionDeadline: new Date(Date.now() + 3_600_000).toISOString() })
      .expect(201);
    const id = create.body.challenge.id as string;

    await request(app.getHttpServer()).get(`/v1/challenges/${id}/submissions`).expect(401);
    const res = await request(app.getHttpServer())
      .get(`/v1/challenges/${id}/submissions`)
      .set('Authorization', `Bearer ${creator.id}`)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('liefert winner=null solange nicht entschieden', async () => {
    const creator = await prisma.user.create({ data: { isAdult: true } });
    const create = await request(app.getHttpServer())
      .post('/v1/challenges')
      .set('Authorization', `Bearer ${creator.id}`)
      .send({ selectionMode: 'CREATOR_DECIDES', prizeAmountCents: 10_000, submissionDeadline: new Date(Date.now() + 3_600_000).toISOString() })
      .expect(201);
    const detail = await request(app.getHttpServer()).get(`/v1/challenges/${create.body.challenge.id}`).expect(200);
    expect(detail.body.winner).toBeNull();
  });

  it('Feed ist ohne Flag nicht verfügbar (404)', async () => {
    await request(app.getHttpServer()).get('/v1/feed').expect(404);
  });
});

describe('GET /health', () => {
  it('meldet ok und DB up', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', db: 'up' });
  });
});
