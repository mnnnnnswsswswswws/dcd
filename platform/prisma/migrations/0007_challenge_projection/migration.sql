-- Read Model der öffentlichen Challenge-Ansicht (Scale S1, Aufgabe 8).
--
-- Wird ausschließlich aus Outbox-Events gepflegt. `occupied_slots` ist bewusst
-- anzeigeorientiert: Der Wert darf hinterherhinken. Autoritativ für die
-- Platzvergabe bleibt die Tabelle `slots` unter Row-Lock (Architekturregel 2 und 3).

CREATE TABLE "challenge_public_projections" (
  "challenge_id"        UUID PRIMARY KEY,
  "title"               TEXT,
  "status"              TEXT NOT NULL,
  "prize_amount_cents"  INTEGER NOT NULL,
  "max_slots"           INTEGER NOT NULL,
  "occupied_slots"      INTEGER NOT NULL DEFAULT 0,
  "selection_mode"      TEXT NOT NULL,
  "submission_deadline" TIMESTAMPTZ(6),
  -- Sequenz des zuletzt angewandten Events: verhindert, dass eine verspätet
  -- zugestellte ältere Nachricht neueren Zustand überschreibt.
  "last_sequence"       BIGINT NOT NULL DEFAULT 0,
  "updated_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE INDEX "challenge_public_projections_status_updated_at_idx"
  ON "challenge_public_projections" ("status", "updated_at");
