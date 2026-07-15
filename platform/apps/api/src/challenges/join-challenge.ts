import { Prisma, PrismaClient, type ChallengeStatus, type SlotStatus } from '@prisma/client';
import { apiError } from '@vcp/contracts';
import { COUNTING_SLOT_STATUSES, FINAL_SUBMISSION_STATUSES } from '@vcp/domain';
import type { EventPublisher } from '../events/event-publisher.js';

/** Slot-Status, die auf das Platz-Limit zählen (typisiert für Prisma-Filter). */
const COUNTING: SlotStatus[] = COUNTING_SLOT_STATUSES as unknown as SlotStatus[];
const FINAL_SUBMISSIONS = FINAL_SUBMISSION_STATUSES as unknown as string[];

/** Default-TTL einer Reservierung: 10 Minuten. Kann pro Aufruf überschrieben werden. */
const DEFAULT_RESERVATION_TTL_MS = 600_000;

/** Transaktions-Budget: bis zu 20s warten und laufen (siehe Build-Auftrag). */
const TRANSACTION_TIMEOUT_MS = 20_000;

export interface JoinChallengeDeps {
  prisma: PrismaClient;
  events: EventPublisher;
  /** Injizierbare Uhr für deterministische Tests. */
  now?: () => Date;
  reservationTtlMs?: number;
}

export interface JoinChallengeInput {
  challengeId: string;
  userId: string;
}

export interface JoinChallengeResult {
  slot: {
    id: string;
    challengeId: string;
    participantId: string;
    status: SlotStatus;
    expiresAt: Date | null;
  };
  challengeStatus: ChallengeStatus;
}

interface LockedChallengeRow {
  id: string;
  creator_id: string;
  status: ChallengeStatus;
  submission_deadline: Date | null;
  max_slots: number;
}

/**
 * Reserviert transaktionssicher einen Teilnehmerplatz in einer Challenge.
 *
 * Reine Funktion: nimmt den `PrismaClient` direkt entgegen (kein NestJS-DI), damit
 * sie ohne Nest-Bootstrap direkt in Vitest testbar ist.
 *
 * Ablauf in einer Transaktion (ReadCommitted, timeout/maxWait 20s):
 *  1. Challenge-Row per `SELECT ... FOR UPDATE` sperren (rohes SQL).
 *  2. Status muss OPEN oder FULL sein, Einsendeschluss nicht überschritten.
 *  3. Ersteller ablehnen; bestehende (zählende) Teilnahme / frühere finale
 *     Einsendung ablehnen.
 *  4. Abgelaufene Reservierungen dieser Challenge freigeben (→ EXPIRED).
 *  5. Zählende Slots zählen; >= maxSlots → CHALLENGE_FULL.
 *  6. Slot RESERVED mit expires_at anlegen (bzw. eigenen abgelaufenen Slot
 *     wiederverwenden); Challenge-Status konsistent auf FULL/OPEN setzen.
 *  7. Commit — danach Event `challenge.slot_reserved` veröffentlichen.
 */
export async function joinChallenge(
  deps: JoinChallengeDeps,
  input: JoinChallengeInput,
): Promise<JoinChallengeResult> {
  const { prisma, events } = deps;
  const now = deps.now?.() ?? new Date();
  const ttlMs = deps.reservationTtlMs ?? DEFAULT_RESERVATION_TTL_MS;
  const { challengeId, userId } = input;

  const result = await prisma.$transaction(
    async (tx) => {
      // 1. Challenge-Row exklusiv sperren. Roh, keine ORM-Abstraktion, damit die
      //    Sperre garantiert vor allen Folge-Reads/Writes greift.
      const locked = await tx.$queryRaw<LockedChallengeRow[]>(Prisma.sql`
        SELECT id, creator_id, status, submission_deadline, max_slots
        FROM challenges
        WHERE id = ${challengeId}::uuid
        FOR UPDATE
      `);

      const challenge = locked[0];
      if (challenge === undefined) {
        throw apiError('CHALLENGE_NOT_FOUND');
      }

      // 2. Beitretbarkeit prüfen.
      if (challenge.status !== 'OPEN' && challenge.status !== 'FULL') {
        throw apiError('CHALLENGE_NOT_JOINABLE');
      }
      if (challenge.submission_deadline !== null && now >= challenge.submission_deadline) {
        throw apiError('CHALLENGE_DEADLINE_PASSED');
      }

      // 3. Ersteller ablehnen.
      if (challenge.creator_id === userId) {
        throw apiError('CREATOR_CANNOT_JOIN');
      }

      // Frühere finale Einsendung des Nutzers ablehnen.
      const existingSubmission = await tx.submission.findUnique({
        where: { challengeId_participantId: { challengeId, participantId: userId } },
      });
      if (existingSubmission && FINAL_SUBMISSIONS.includes(existingSubmission.status)) {
        throw apiError('ALREADY_SUBMITTED');
      }

      // Bestehende (zählende) Teilnahme ablehnen; abgelaufene/stornierte Slots des
      // Nutzers dürfen wiederverwendet werden.
      const existingSlot = await tx.slot.findUnique({
        where: { challengeId_participantId: { challengeId, participantId: userId } },
      });
      if (existingSlot && COUNTING.includes(existingSlot.status)) {
        throw apiError('ALREADY_JOINED');
      }

      // 4. Abgelaufene Reservierungen dieser Challenge freigeben.
      await tx.slot.updateMany({
        where: { challengeId, status: 'RESERVED', expiresAt: { lt: now } },
        data: { status: 'EXPIRED' },
      });

      // 5. Zählende Slots zählen.
      const occupiedBefore = await tx.slot.count({
        where: { challengeId, status: { in: COUNTING } },
      });
      if (occupiedBefore >= challenge.max_slots) {
        throw apiError('CHALLENGE_FULL');
      }

      // 6. Slot reservieren (eigenen abgelaufenen Slot wiederverwenden, um den
      //    Unique-Constraint (challenge_id, participant_id) zu respektieren).
      const expiresAt = new Date(now.getTime() + ttlMs);
      const slot = existingSlot
        ? await tx.slot.update({
            where: { id: existingSlot.id },
            data: { status: 'RESERVED', expiresAt, reservedAt: now },
          })
        : await tx.slot.create({
            data: { challengeId, participantId: userId, status: 'RESERVED', expiresAt, reservedAt: now },
          });

      // Challenge-Status konsistent halten: voll → FULL, sonst OPEN.
      const occupiedAfter = occupiedBefore + 1;
      const desiredStatus: ChallengeStatus = occupiedAfter >= challenge.max_slots ? 'FULL' : 'OPEN';
      if (challenge.status !== desiredStatus) {
        await tx.challenge.update({
          where: { id: challengeId },
          data: { status: desiredStatus },
        });
      }

      return {
        slot: {
          id: slot.id,
          challengeId: slot.challengeId,
          participantId: slot.participantId,
          status: slot.status,
          expiresAt: slot.expiresAt,
        },
        challengeStatus: desiredStatus,
      } satisfies JoinChallengeResult;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      timeout: TRANSACTION_TIMEOUT_MS,
      maxWait: TRANSACTION_TIMEOUT_MS,
    },
  );

  // 7. Nach dem Commit: Event veröffentlichen (nie innerhalb der Transaktion).
  await events.publish({
    type: 'challenge.slot_reserved',
    occurredAt: now,
    payload: {
      challengeId,
      slotId: result.slot.id,
      participantId: userId,
      expiresAt: result.slot.expiresAt?.toISOString() ?? null,
    },
  });

  return result;
}
