-- Scale Phase S0 — Zuverlässigkeits- und Skalierungsinfrastruktur.
--
-- PostgreSQL bleibt autoritativ. Diese Tabellen tragen die Garantien, die Redis,
-- CDN und Read Models ausdrücklich NICHT geben dürfen: Outbox-Kopplung an den
-- Domänen-Commit, Consumer-Idempotenz und kritische Idempotenzschlüssel.

CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PUBLISHING', 'PUBLISHED', 'FAILED');
CREATE TYPE "AsyncOperationStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "IdempotencyStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- ── Transactional Outbox ───────────────────────────────────────────────────
-- Wird im selben Commit wie die Domänenänderung geschrieben. `sequence` ist
-- monoton und dient Reihenfolge sowie Projektions-Checkpoints.
CREATE TABLE "outbox_events" (
  "sequence"       BIGSERIAL PRIMARY KEY,
  "event_id"       UUID NOT NULL DEFAULT gen_random_uuid(),
  "aggregate_type" TEXT NOT NULL,
  "aggregate_id"   TEXT NOT NULL,
  "event_type"     TEXT NOT NULL,
  "payload"        JSONB NOT NULL,
  "status"         "OutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attempts"       INTEGER NOT NULL DEFAULT 0,
  "available_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "published_at"   TIMESTAMPTZ(6),
  "last_error"     TEXT,
  "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "outbox_events_event_id_key" ON "outbox_events" ("event_id");
-- Deckt exakt die Publisher-Abfrage ab (FOR UPDATE SKIP LOCKED, älteste zuerst).
CREATE INDEX "outbox_events_status_available_at_sequence_idx"
  ON "outbox_events" ("status", "available_at", "sequence");
CREATE INDEX "outbox_events_aggregate_type_aggregate_id_idx"
  ON "outbox_events" ("aggregate_type", "aggregate_id");

-- ── Consumer-Inbox ─────────────────────────────────────────────────────────
-- Unique auf (message_id, handler_name): dieselbe Nachricht darf von mehreren
-- Handlern verarbeitet werden, von jedem aber genau einmal.
CREATE TABLE "processed_messages" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "message_id"   TEXT NOT NULL,
  "handler_name" TEXT NOT NULL,
  "result_json"  JSONB,
  "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "processed_messages_message_id_handler_name_key"
  ON "processed_messages" ("message_id", "handler_name");
CREATE INDEX "processed_messages_processed_at_idx" ON "processed_messages" ("processed_at");

-- ── Asynchrone Operationen (202 Accepted) ──────────────────────────────────
CREATE TABLE "async_operations" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "kind"          TEXT NOT NULL,
  "status"        "AsyncOperationStatus" NOT NULL DEFAULT 'PENDING',
  "owner_user_id" UUID,
  "resource_type" TEXT,
  "resource_id"   TEXT,
  "progress"      INTEGER NOT NULL DEFAULT 0,
  "result_json"   JSONB,
  "error_code"    TEXT,
  "error_message" TEXT,
  "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "expires_at"    TIMESTAMPTZ(6)
);
CREATE INDEX "async_operations_owner_user_id_created_at_idx"
  ON "async_operations" ("owner_user_id", "created_at");
CREATE INDEX "async_operations_status_created_at_idx"
  ON "async_operations" ("status", "created_at");

-- ── Projektions-Checkpoints ────────────────────────────────────────────────
CREATE TABLE "projection_checkpoints" (
  "projection_name" TEXT PRIMARY KEY,
  "last_sequence"   BIGINT NOT NULL DEFAULT 0,
  "updated_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

-- ── Kritische Idempotenz (bewusst in PostgreSQL, nicht nur Redis) ──────────
CREATE TABLE "idempotency_records" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "scope"         TEXT NOT NULL,
  "key"           TEXT NOT NULL,
  "request_hash"  TEXT NOT NULL,
  "status"        "IdempotencyStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "response_json" JSONB,
  "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "completed_at"  TIMESTAMPTZ(6),
  "expires_at"    TIMESTAMPTZ(6)
);
CREATE UNIQUE INDEX "idempotency_records_scope_key_key" ON "idempotency_records" ("scope", "key");
CREATE INDEX "idempotency_records_expires_at_idx" ON "idempotency_records" ("expires_at");

-- ── Versionierte Cache-Namespaces ──────────────────────────────────────────
-- Invalidierung durch Versions-Bump; alte Schlüssel werden dadurch unerreichbar.
CREATE TABLE "cache_namespaces" (
  "namespace" TEXT PRIMARY KEY,
  "version"   INTEGER NOT NULL DEFAULT 1,
  "bumped_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

-- ── Geshardete Zähler (nur Anzeige, nie Entscheidungsgrundlage) ────────────
CREATE TABLE "counter_shards" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "counter_type" TEXT NOT NULL,
  "entity_id"    TEXT NOT NULL,
  "shard"        INTEGER NOT NULL,
  "value"        BIGINT NOT NULL DEFAULT 0,
  "updated_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "counter_shards_counter_type_entity_id_shard_key"
  ON "counter_shards" ("counter_type", "entity_id", "shard");
CREATE INDEX "counter_shards_counter_type_entity_id_idx"
  ON "counter_shards" ("counter_type", "entity_id");

-- ── Abgeleitete Kapazitätskonfiguration ────────────────────────────────────
CREATE TABLE "service_capacity_configs" (
  "service"         TEXT PRIMARY KEY,
  "max_instances"   INTEGER NOT NULL,
  "concurrency"     INTEGER NOT NULL,
  "db_pool_size"    INTEGER NOT NULL,
  "redis_pool_size" INTEGER NOT NULL DEFAULT 0,
  "notes"           TEXT,
  "updated_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
