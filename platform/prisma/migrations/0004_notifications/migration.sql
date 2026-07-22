-- In-App-Benachrichtigungen, abgeleitet aus Domänenereignissen (Veröffentlichung,
-- Moderationsergebnis, Gewinn). Kein Push — reine In-App-Zustellung.

CREATE TABLE "notifications" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"      UUID NOT NULL REFERENCES "users"("id"),
  "type"         TEXT NOT NULL,
  "challenge_id" UUID,
  "title"        TEXT NOT NULL,
  "body"         TEXT NOT NULL,
  "read_at"      TIMESTAMPTZ(6),
  "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications" ("user_id", "created_at");
