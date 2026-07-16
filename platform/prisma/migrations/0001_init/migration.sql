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

CREATE TYPE "FundingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED', 'REFUNDED');

CREATE TYPE "LedgerDirection" AS ENUM ('DEBIT', 'CREDIT');

CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'HELD', 'PAID', 'FAILED');

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
  "finalized_at"   TIMESTAMPTZ(6),
  "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
-- Eine gültige Einsendung pro Nutzer pro Challenge.
CREATE UNIQUE INDEX "submissions_challenge_id_participant_id_key"
  ON "submissions" ("challenge_id", "participant_id");
CREATE INDEX "submissions_challenge_id_status_idx" ON "submissions" ("challenge_id", "status");

-- votes -----------------------------------------------------------------------
CREATE TABLE "votes" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "challenge_id"  UUID NOT NULL REFERENCES "challenges"("id"),
  "submission_id" UUID NOT NULL REFERENCES "submissions"("id"),
  "voter_id"      UUID NOT NULL REFERENCES "users"("id"),
  "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
-- Eine Stimme pro Nutzer pro Challenge.
CREATE UNIQUE INDEX "votes_challenge_id_voter_id_key" ON "votes" ("challenge_id", "voter_id");
CREATE INDEX "votes_submission_id_idx" ON "votes" ("submission_id");

-- payouts ---------------------------------------------------------------------
CREATE TABLE "payouts" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "challenge_id"    UUID NOT NULL REFERENCES "challenges"("id"),
  "submission_id"   UUID NOT NULL REFERENCES "submissions"("id"),
  "amount_cents"    INTEGER NOT NULL,
  "status"          "PayoutStatus" NOT NULL DEFAULT 'PENDING',
  "idempotency_key" TEXT NOT NULL,
  "provider_ref"    TEXT,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "paid_at"         TIMESTAMPTZ(6)
);
CREATE UNIQUE INDEX "payouts_challenge_id_key" ON "payouts" ("challenge_id");
CREATE UNIQUE INDEX "payouts_idempotency_key_key" ON "payouts" ("idempotency_key");

-- winner_decisions ------------------------------------------------------------
CREATE TABLE "winner_decisions" (
  "id"                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "challenge_id"         UUID NOT NULL REFERENCES "challenges"("id"),
  "winner_submission_id" UUID,
  "decision_source"      TEXT NOT NULL,
  "created_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
-- Genau eine Winner-Decision pro Challenge.
CREATE UNIQUE INDEX "winner_decisions_challenge_id_key"
  ON "winner_decisions" ("challenge_id");

-- challenge_fundings ----------------------------------------------------------
CREATE TABLE "challenge_fundings" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "challenge_id"    UUID NOT NULL REFERENCES "challenges"("id"),
  "provider"        TEXT NOT NULL,
  "provider_ref"    TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "amount_cents"    INTEGER NOT NULL,
  "currency"        TEXT NOT NULL DEFAULT 'eur',
  "status"          "FundingStatus" NOT NULL DEFAULT 'PENDING',
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "confirmed_at"    TIMESTAMPTZ(6)
);
CREATE UNIQUE INDEX "challenge_fundings_challenge_id_key" ON "challenge_fundings" ("challenge_id");
CREATE UNIQUE INDEX "challenge_fundings_provider_ref_key" ON "challenge_fundings" ("provider_ref");
CREATE UNIQUE INDEX "challenge_fundings_idempotency_key_key" ON "challenge_fundings" ("idempotency_key");
CREATE INDEX "challenge_fundings_status_idx" ON "challenge_fundings" ("status");

-- audit_logs (append-only, siehe Trigger unten) -------------------------------
CREATE TABLE "audit_logs" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "actor_type"  TEXT NOT NULL,
  "actor_id"    UUID,
  "action"      TEXT NOT NULL,
  "target_type" TEXT NOT NULL,
  "target_id"   UUID NOT NULL,
  "before_json" JSONB,
  "after_json"  JSONB,
  "request_id"  TEXT,
  "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE INDEX "audit_logs_target_type_target_id_idx" ON "audit_logs" ("target_type", "target_id");

-- ledger_entries (append-only, siehe Trigger unten) ---------------------------
CREATE TABLE "ledger_entries" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "challenge_id" UUID NOT NULL REFERENCES "challenges"("id"),
  "account"      TEXT NOT NULL,
  "direction"    "LedgerDirection" NOT NULL,
  "amount_cents" INTEGER NOT NULL,
  "entry_type"   TEXT NOT NULL,
  "reference_id" UUID,
  "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE INDEX "ledger_entries_challenge_id_idx" ON "ledger_entries" ("challenge_id");

-- Unveränderlichkeit der Buchführung erzwingen.
CREATE OR REPLACE FUNCTION reject_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries ist unveränderlich (append-only)';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entries_no_update
  BEFORE UPDATE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

CREATE TRIGGER ledger_entries_no_delete
  BEFORE DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

-- Unveränderlichkeit der Audit-Logs erzwingen.
CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs ist unveränderlich (append-only)';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

CREATE TRIGGER audit_logs_no_delete
  BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
