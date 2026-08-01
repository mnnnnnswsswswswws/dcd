-- Öffentliche Profile: Nutzername (eindeutig), Anzeigename, Bio. Alle optional —
-- die anonyme 18+-Registrierung bleibt unverändert gültig.

ALTER TABLE "users" ADD COLUMN "username" TEXT;
ALTER TABLE "users" ADD COLUMN "display_name" TEXT;
ALTER TABLE "users" ADD COLUMN "bio" TEXT;

-- Eindeutiger Nutzername; NULL ist in Postgres mehrfach erlaubt (viele anonyme Nutzer).
CREATE UNIQUE INDEX "users_username_key" ON "users" ("username");
