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

/**
 * End-to-End über HTTP: erstellen → Webhook → beitreten → einreichen → moderieren →
 * Einsendeschluss → Gewinnerauswahl → Auszahlung. Admin-Token via `admin:<id>`.
 */
let app: INestApplication;
let prisma: PrismaService;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? 'dev-webhook-secret';
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

describe('Geld-raus-Loop über HTTP', () => {
  it('vollständiger Fluss create → fund → join → submit → moderate → close → select → payout', async () => {
    const creator = await prisma.user.create({ data: { isAdult: true } });

    // Erstellen + Finanzieren.
    const create = await http()
      .post('/v1/challenges')
      .set('Authorization', `Bearer ${creator.id}`)
      .send({ selectionMode: 'CREATOR_DECIDES', prizeAmountCents: 10_000, submissionDeadline: new Date(Date.now() + 3_600_000).toISOString() })
      .expect(201);
    const challengeId = create.body.challenge.id as string;
    await http()
      .post('/v1/webhooks/payments')
      .set('x-webhook-secret', WEBHOOK_SECRET)
      .send({ type: 'funding.succeeded', providerRef: create.body.funding.providerRef, amountCents: 10_000 })
      .expect(200);

    // Zwei Teilnehmer treten bei und reichen ein.
    const submissionIds: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const p = await prisma.user.create({ data: { isAdult: true } });
      await http().post(`/v1/challenges/${challengeId}/join`).set('Authorization', `Bearer ${p.id}`).expect(201);
      const sub = await http().post(`/v1/challenges/${challengeId}/submit`).set('Authorization', `Bearer ${p.id}`).expect(201);
      submissionIds.push(sub.body.submissionId);
    }

    // Moderation ohne Admin → 403.
    const nonAdmin = await prisma.user.create({ data: { isAdult: true } });
    await http()
      .post(`/v1/submissions/${submissionIds[0]}/moderate`)
      .set('Authorization', `Bearer ${nonAdmin.id}`)
      .send({ decision: 'APPROVED' })
      .expect(403);

    // Admin gibt beide frei.
    for (const sid of submissionIds) {
      await http().post(`/v1/submissions/${sid}/moderate`).set('Authorization', `Bearer ${ADMIN}`).send({ decision: 'APPROVED' }).expect(200);
    }

    // Einsendeschluss (Admin), dann Gewinnerauswahl (Ersteller).
    await http().post(`/v1/challenges/${challengeId}/close`).set('Authorization', `Bearer ${ADMIN}`).expect(200);
    const select = await http()
      .post(`/v1/challenges/${challengeId}/select-winner`)
      .set('Authorization', `Bearer ${creator.id}`)
      .send({ winnerSubmissionId: submissionIds[0] })
      .expect(200);
    expect(select.body).toMatchObject({ winnerSubmissionId: submissionIds[0], decisionSource: 'CREATOR' });

    const locked = await http().get(`/v1/challenges/${challengeId}`).expect(200);
    expect(locked.body.status).toBe('WINNER_LOCKED');

    // Auszahlung (Admin): bei deaktiviertem Flag zurückgehalten.
    const payout = await http().post(`/v1/challenges/${challengeId}/payout`).set('Authorization', `Bearer ${ADMIN}`).expect(200);
    expect(payout.body).toMatchObject({ paid: false, status: 'HELD' });

    // Erneute Auswahl ist idempotent.
    const again = await http()
      .post(`/v1/challenges/${challengeId}/select-winner`)
      .set('Authorization', `Bearer ${creator.id}`)
      .send({ winnerSubmissionId: submissionIds[0] })
      .expect(200);
    expect(again.body.alreadyDecided).toBe(true);
  });
});
