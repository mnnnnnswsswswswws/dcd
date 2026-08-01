-- In-App-Beweisaufnahme (Spec: In-App-Beweisaufnahme ohne Galerieimport/Schnitt).
-- Hinter Feature-Flag LONG_CAPTURE_ENABLED; Default-Betrieb bleibt der bisherige Stub.

CREATE TYPE "EvidenceStatus" AS ENUM ('PENDING', 'UPLOADED', 'ATTACHED', 'EXPIRED');

CREATE TABLE "evidence_assets" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "challenge_id"    UUID NOT NULL REFERENCES "challenges"("id"),
  "participant_id"  UUID NOT NULL REFERENCES "users"("id"),
  "storage_key"     TEXT NOT NULL,
  "status"          "EvidenceStatus" NOT NULL DEFAULT 'PENDING',
  "captured_in_app" BOOLEAN NOT NULL DEFAULT true,
  "duration_ms"     INTEGER,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE INDEX "evidence_assets_challenge_id_participant_id_idx"
  ON "evidence_assets" ("challenge_id", "participant_id");

-- Verweis der Einsendung auf den gebundenen Beweis.
ALTER TABLE "submissions" ADD COLUMN "evidence_ref" UUID;
