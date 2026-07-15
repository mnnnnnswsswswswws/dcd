-- Video-Challenge-Plattform — Initiale Migration (handgeschrieben).
-- Erzeugt Enums, Tabellen, Constraints und Indizes passend zu prisma/schema.prisma.

-- Enums -----------------------------------------------------------------------
CREATE TYPE "ChallengeStatus" AS ENUM (
  'DRAFT', 'PENDING_FUNDING', 'OPEN', 'FULL', 'SUBMISSIONS_CLOSED',
  'IN_REVIEW', 'SELECTION', 'WINNER_LOCKED', 'PAID_OUT', 'CANCELLED', 'EXPIRED'
);

CREATE TYPE "SlotStatus" AS ENUM (
  'RESERVED', 'CAPTURING', 'UPLOADING', 'SUBMITTED', 'EXPIRED', 'CANCELLED'
);

CREATE TYPE "SubmissionStatus" AS ENUM (
  'DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'WINNER', 'LOSER'
);

CREATE TYPE "SelectionMode" AS ENUM ('CREATOR_DECIDES', 'COMMUNITY_VOTE');

-- users -----------------------------------------------------------------------
CREATE TABLE "users" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "is_adult"   BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

-- challenges ------------------------------------------------------------------
CREATE TABLE "challenges" (
  "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "creator_id"          UUID NOT NULL REFERENCES "users"("id"),
  "status"              "ChallengeStatus" NOT NULL DEFAULT 'DRAFT',
  "selection_mode"      "SelectionMode" NOT NULL,
  "prize_amount_cents"  INTEGER NOT NULL,
  "max_slots"           INTEGER NOT NULL DEFAULT 10,
  "submission_deadline" TIMESTAMPTZ(6),
  "created_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE INDEX "challenges_status_idx" ON "challenges" ("status");

-- slots -----------------------------------------------------------------------
CREATE TABLE "slots" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "challenge_id"   UUID NOT NULL REFERENCES "challenges"("id"),
  "participant_id" UUID NOT NULL REFERENCES "users"("id"),
  "status"         "SlotStatus" NOT NULL DEFAULT 'RESERVED',
  "expires_at"     TIMESTAMPTZ(6),
  "reserved_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
-- Ein Nutzer belegt höchstens einen Slot pro Challenge.
CREATE UNIQUE INDEX "slots_challenge_id_participant_id_key"
  ON "slots" ("challenge_id", "participant_id");
CREATE INDEX "slots_challenge_id_status_idx" ON "slots" ("challenge_id", "status");

-- submissions -----------------------------------------------------------------
CREATE TABLE "submissions" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "challenge_id"   UUID NOT NULL REFERENCES "challenges"("id"),
  "participant_id" UUID NOT NULL REFERENCES "users"("id"),
  "status"         "SubmissionStatus" NOT NULL DEFAULT 'DRAFT',
  "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
-- Eine gültige Einsendung pro Nutzer pro Challenge.
CREATE UNIQUE INDEX "submissions_challenge_id_participant_id_key"
  ON "submissions" ("challenge_id", "participant_id");
CREATE INDEX "submissions_challenge_id_status_idx" ON "submissions" ("challenge_id", "status");

-- winner_decisions ------------------------------------------------------------
CREATE TABLE "winner_decisions" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "challenge_id"    UUID NOT NULL REFERENCES "challenges"("id"),
  "winner_slot_id"  UUID,
  "decision_source" TEXT NOT NULL,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
-- Genau eine Winner-Decision pro Challenge.
CREATE UNIQUE INDEX "winner_decisions_challenge_id_key"
  ON "winner_decisions" ("challenge_id");
