import { Prisma, PrismaClient, type ChallengeStatus, type SlotStatus } from '@prisma/client';
import { COUNTING_SLOT_STATUSES } from '@vcp/domain';
import type { EventPublisher } from '../events/event-publisher.js';

/** Slot-Status, die auf das Platz-Limit zählen (typisiert für Prisma-Filter). */
const COUNTING: SlotStatus[] = COUNTING_SLOT_STATUSES as unknown as SlotStatus[];

/** Transaktions-Budget pro Challenge: bis zu 20s warten und laufen. */
const TRANSACTION_TIMEOUT_MS = 20_000;

export interface ExpireSlotsDeps {
  prisma: PrismaClient;
  events: EventPublisher;
  /** Injizierbare Uhr für deterministische Tests. */
  now?: () => Date;
}

export interface ExpireSlotsResult {
  /** Anzahl freigegebener (→ EXPIRED) Reservierungen über alle Challenges. */
  expiredSlotCount: number;
  /** Challenges, deren Status durch Freigabe von FULL auf OPEN wechselte. */
  reopenedChallengeIds: string[];
  /** Alle Challenges, die in diesem Lauf verarbeitet wurden. */
  processedChallengeIds: string[];
}

interface LockedChallengeRow {
  id: string;
  status: ChallengeStatus;
  max_slots: number;
}

/**
 * Gibt abgelaufene Reservierungen frei und öffnet dadurch volle Challenges wieder.
 *
 * Reine Funktion (kein NestJS-DI), im gleichen Muster wie `joinChallenge`:
 * verarbeitet jede betroffene Challenge in einer eigenen Transaktion und sperrt
 * die Challenge-Row per `SELECT ... FOR UPDATE`, damit der Worker nicht mit einem
 * gleichzeitigen `joinChallenge` um dieselben Plätze konkurriert.
 *
 * Pro Challenge in einer Transaktion (ReadCommitted, timeout/maxWait 20s):
 *  1. Challenge-Row sperren.
 *  2. Abgelaufene RESERVED-Slots (expires_at < now) → EXPIRED.
 *  3. Zählende Slots neu zählen; ist die Challenge FULL und nun < max_slots
 *     belegt, Status → OPEN (wieder beitretbar).
 *  4. Commit — danach Events veröffentlichen (nie innerhalb der Transaktion).
 */
export async function expireSlots(deps: ExpireSlotsDeps): Promise<ExpireSlotsResult> {
  const { prisma, events } = deps;
  const now = deps.now?.() ?? new Date();

  // Kandidaten: Challenges mit mindestens einer abgelaufenen Reservierung.
  const candidates = await prisma.slot.findMany({
    where: { status: 'RESERVED', expiresAt: { lt: now } },
    select: { challengeId: true },
    distinct: ['challengeId'],
  });

  const result: ExpireSlotsResult = {
    expiredSlotCount: 0,
    reopenedChallengeIds: [],
    processedChallengeIds: [],
  };

  for (const { challengeId } of candidates) {
    const outcome = await prisma.$transaction(
      async (tx) => {
        // 1. Challenge-Row exklusiv sperren.
        const locked = await tx.$queryRaw<LockedChallengeRow[]>(Prisma.sql`
          SELECT id, status, max_slots
          FROM challenges
          WHERE id = ${challengeId}::uuid
          FOR UPDATE
        `);
        const challenge = locked[0];
        if (challenge === undefined) {
          return { expired: 0, reopened: false };
        }

        // 2. Abgelaufene Reservierungen freigeben.
        const { count: expired } = await tx.slot.updateMany({
          where: { challengeId, status: 'RESERVED', expiresAt: { lt: now } },
          data: { status: 'EXPIRED' },
        });
        if (expired === 0) {
          return { expired: 0, reopened: false };
        }

        // 3. Volle Challenge mit nun freiem Platz wieder öffnen.
        let reopened = false;
        if (challenge.status === 'FULL') {
          const occupied = await tx.slot.count({
            where: { challengeId, status: { in: COUNTING } },
          });
          if (occupied < challenge.max_slots) {
            await tx.challenge.update({ where: { id: challengeId }, data: { status: 'OPEN' } });
            reopened = true;
          }
        }

        return { expired, reopened };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: TRANSACTION_TIMEOUT_MS,
        maxWait: TRANSACTION_TIMEOUT_MS,
      },
    );

    if (outcome.expired === 0) {
      continue;
    }

    result.processedChallengeIds.push(challengeId);
    result.expiredSlotCount += outcome.expired;
    if (outcome.reopened) {
      result.reopenedChallengeIds.push(challengeId);
    }

    // 4. Nach dem Commit: Events veröffentlichen.
    await events.publish({
      type: 'challenge.slots_expired',
      occurredAt: now,
      payload: { challengeId, expiredCount: outcome.expired },
    });
    if (outcome.reopened) {
      await events.publish({
        type: 'challenge.reopened',
        occurredAt: now,
        payload: { challengeId },
      });
    }
  }

  return result;
}
