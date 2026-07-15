import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { MockPaymentProvider } from '@vcp/payments';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createChallenge } from '../src/challenges/create-challenge.js';
import { confirmFunding } from '../src/funding/confirm-funding.js';
import { joinChallenge } from '../src/challenges/join-challenge.js';
import { InMemoryEventPublisher } from '../src/events/event-publisher.js';
import { resetDb } from './reset-db.js';

/**
 * Lebenszyklus: Challenge erstellen (PENDING_FUNDING) → Vollfinanzierung per Webhook
 * bestätigen (→ OPEN) → beitreten. Deckt Idempotenz, doppelte Buchung und die
 * Unveränderlichkeit des Ledgers ab.
 *
 * Voraussetzung: laufende PostgreSQL mit angewandtem Schema + Immutability-Trigger
 * (prisma/sql/immutability.sql) und gesetztem DATABASE_URL.
 */
const prisma = new PrismaClient();

async function makeCreator(): Promise<string> {
  const u = await prisma.user.create({ data: { isAdult: true } });
  return u.id;
}

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await resetDb(prisma);
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb(prisma);
});

describe('Challenge-Lebenszyklus', () => {
  it('erstellt PENDING_FUNDING, veröffentlicht erst nach Webhook, dann Beitritt möglich', async () => {
    const events = new InMemoryEventPublisher();
    const payments = new MockPaymentProvider();
    const creatorId = await makeCreator();

    const created = await createChallenge(
      { prisma, payments, events },
      {
        creatorId,
        selectionMode: 'CREATOR_DECIDES',
        prizeAmountCents: 10_000,
        submissionDeadline: new Date(Date.now() + 3_600_000),
      },
    );
    expect(created.challenge.status).toBe('PENDING_FUNDING');
    expect(created.funding.clientSecret).toBeTruthy();

    // Beitritt vor Finanzierung ist nicht möglich.
    const participantId = (await prisma.user.create({ data: { isAdult: true } })).id;
    await expect(
      joinChallenge({ prisma, events }, { challengeId: created.challenge.id, userId: participantId }),
    ).rejects.toMatchObject({ code: 'CHALLENGE_NOT_JOINABLE' });

    // Webhook bestätigt Vollfinanzierung → Veröffentlichung.
    const confirm = await confirmFunding(
      { prisma, events },
      { providerRef: created.funding.providerRef, amountCents: 10_000 },
    );
    expect(confirm).toMatchObject({ published: true, alreadyConfirmed: false });

    const published = await prisma.challenge.findUniqueOrThrow({ where: { id: created.challenge.id } });
    expect(published.status).toBe('OPEN');

    // Doppelte Buchung: 2 Einträge, Summe Soll == Summe Haben == Preissumme.
    const ledger = await prisma.ledgerEntry.findMany({ where: { challengeId: created.challenge.id } });
    expect(ledger).toHaveLength(2);
    const debit = ledger.filter((e) => e.direction === 'DEBIT').reduce((s, e) => s + e.amountCents, 0);
    const credit = ledger.filter((e) => e.direction === 'CREDIT').reduce((s, e) => s + e.amountCents, 0);
    expect(debit).toBe(10_000);
    expect(credit).toBe(10_000);

    // Jetzt ist der Beitritt möglich.
    const joined = await joinChallenge(
      { prisma, events },
      { challengeId: created.challenge.id, userId: participantId },
    );
    expect(joined.slot.status).toBe('RESERVED');
  });

  it('ist idempotent bei doppelter Webhook-Zustellung', async () => {
    const events = new InMemoryEventPublisher();
    const payments = new MockPaymentProvider();
    const creatorId = await makeCreator();
    const created = await createChallenge(
      { prisma, payments, events },
      { creatorId, selectionMode: 'CREATOR_DECIDES', prizeAmountCents: 5_000, submissionDeadline: new Date(Date.now() + 3_600_000) },
    );

    const first = await confirmFunding({ prisma, events }, { providerRef: created.funding.providerRef, amountCents: 5_000 });
    const second = await confirmFunding({ prisma, events }, { providerRef: created.funding.providerRef, amountCents: 5_000 });
    expect(first).toMatchObject({ published: true, alreadyConfirmed: false });
    expect(second).toMatchObject({ published: false, alreadyConfirmed: true });

    // Keine doppelten Buchungen.
    const ledgerCount = await prisma.ledgerEntry.count({ where: { challengeId: created.challenge.id } });
    expect(ledgerCount).toBe(2);
  });

  it('lehnt einen abweichenden Betrag ab', async () => {
    const events = new InMemoryEventPublisher();
    const payments = new MockPaymentProvider();
    const creatorId = await makeCreator();
    const created = await createChallenge(
      { prisma, payments, events },
      { creatorId, selectionMode: 'COMMUNITY_VOTE', prizeAmountCents: 7_500, submissionDeadline: new Date(Date.now() + 3_600_000) },
    );

    await expect(
      confirmFunding({ prisma, events }, { providerRef: created.funding.providerRef, amountCents: 7_499 }),
    ).rejects.toMatchObject({ code: 'FUNDING_AMOUNT_MISMATCH' });

    const still = await prisma.challenge.findUniqueOrThrow({ where: { id: created.challenge.id } });
    expect(still.status).toBe('PENDING_FUNDING');
  });

  it('lehnt eine unbekannte Zahlung ab', async () => {
    const events = new InMemoryEventPublisher();
    await expect(
      confirmFunding({ prisma, events }, { providerRef: `pi_${randomUUID()}`, amountCents: 100 }),
    ).rejects.toMatchObject({ code: 'FUNDING_NOT_FOUND' });
  });

  it('erzwingt Unveränderlichkeit der Buchführung (DB-Trigger)', async () => {
    const events = new InMemoryEventPublisher();
    const payments = new MockPaymentProvider();
    const creatorId = await makeCreator();
    const created = await createChallenge(
      { prisma, payments, events },
      { creatorId, selectionMode: 'CREATOR_DECIDES', prizeAmountCents: 1_000, submissionDeadline: new Date(Date.now() + 3_600_000) },
    );
    await confirmFunding({ prisma, events }, { providerRef: created.funding.providerRef, amountCents: 1_000 });

    // UPDATE auf ledger_entries muss vom Trigger hart abgelehnt werden.
    await expect(
      prisma.ledgerEntry.updateMany({ where: { challengeId: created.challenge.id }, data: { amountCents: 1 } }),
    ).rejects.toThrow();
  });
});
