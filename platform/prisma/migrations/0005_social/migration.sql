-- Social-Layer: Likes, Merkzettel (Bookmarks) und Kommentare zu Challenges.

CREATE TABLE "challenge_likes" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "challenge_id" UUID NOT NULL REFERENCES "challenges"("id"),
  "user_id"      UUID NOT NULL REFERENCES "users"("id"),
  "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "challenge_likes_challenge_id_user_id_key" ON "challenge_likes" ("challenge_id", "user_id");
CREATE INDEX "challenge_likes_challenge_id_idx" ON "challenge_likes" ("challenge_id");

CREATE TABLE "challenge_bookmarks" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "challenge_id" UUID NOT NULL REFERENCES "challenges"("id"),
  "user_id"      UUID NOT NULL REFERENCES "users"("id"),
  "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "challenge_bookmarks_challenge_id_user_id_key" ON "challenge_bookmarks" ("challenge_id", "user_id");
CREATE INDEX "challenge_bookmarks_user_id_idx" ON "challenge_bookmarks" ("user_id");

CREATE TABLE "comments" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "challenge_id" UUID NOT NULL REFERENCES "challenges"("id"),
  "user_id"      UUID NOT NULL REFERENCES "users"("id"),
  "body"         TEXT NOT NULL,
  "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE INDEX "comments_challenge_id_created_at_idx" ON "comments" ("challenge_id", "created_at");
