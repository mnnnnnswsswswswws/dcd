# Video-Challenge-Plattform

Bezahlte Video-Challenge-Plattform, mobile-first. Startmarkt Deutschland, EUR,
ausschließlich 18+. Dieses Verzeichnis enthält den **fokussierten Phase-0-Kern**
plus die aktive Aufgabe **`joinChallenge`** (transaktionssichere Slot-Reservierung).

> Code und Identifier sind Englisch; alle nutzersichtbaren Texte und Fehlermeldungen
> sind Deutsch. Geldbeträge ausschließlich als Integer in Cent. Timestamps in UTC,
> IDs als UUID. Alle Feature-Flags default `false`.

## Stack

- Monorepo: pnpm Workspaces + Turborepo
- API-Kern: TypeScript (rahmenagnostische reine Funktionen, Ziel NestJS 10 / Cloud Run)
- DB: PostgreSQL 16 + Prisma 5
- Tests: Vitest

## Layout

```
prisma/
  schema.prisma                     # User, Challenge, Slot, Submission, WinnerDecision (+ Enums)
  migrations/0001_init/migration.sql# handgeschriebene Init-Migration
packages/
  contracts/  ERROR_CODES (deutsche Meldungen) + apiError()
  domain/     State-Machines als Übergangsmatrizen + COUNTING_SLOT_STATUSES
  config/     Zod-Env-Schema mit Flag-Konsistenz-Guards
apps/
  api/
    src/main.ts                              # NestJS-Bootstrap (Port aus @vcp/config)
    src/app.module.ts                        # Wurzelmodul
    src/challenges/challenges.controller.ts  # POST /v1/challenges/:id/join, GET /v1/challenges/:id
    src/challenges/join-challenge.ts         # reine, transaktionssichere Slot-Reservierung
    src/challenges/join-challenge.handler.ts # framework-agnostischer HTTP-Adapter
    src/auth/*                               # TokenVerifier (Mock/Firebase-Slot), AuthGuard
    src/prisma/*                             # PrismaService/-Module
    src/common/app-error.filter.ts           # AppError → einheitliche Fehlerantwort
    src/health/health.controller.ts          # GET /health
    src/workers/expire-slots.ts              # Slot-Expiration-Worker (reine Funktion)
    src/workers/run-expire-slots.ts          # Runner (Intervall-Loop / --once)
    src/events/event-publisher.ts            # EventPublisher-Kontrakt + In-Memory/Logging-Impl
    test/join-challenge.integration.test.ts  # Pflichttest: 50 parallele Joins → exakt 10 Plätze
    test/expire-slots.integration.test.ts    # Worker: Freigabe abgelaufener Slots + FULL→OPEN
    test/challenges.e2e.test.ts              # HTTP-e2e: join/get/health inkl. Auth & Fehlercodes
```

## `joinChallenge` — Design

Reine Funktion, nimmt den `PrismaClient` direkt entgegen (kein NestJS-DI), damit sie
ohne Nest-Bootstrap direkt in Vitest testbar ist. Ablauf in **einer** Transaktion
(`ReadCommitted`, timeout/maxWait 20s):

1. Challenge-Row per `SELECT ... FOR UPDATE` (rohes SQL) sperren.
2. Status muss `OPEN` oder `FULL` sein, Einsendeschluss nicht überschritten.
3. Ersteller ablehnen; bestehende zählende Teilnahme / frühere finale Einsendung ablehnen.
4. Abgelaufene Reservierungen dieser Challenge freigeben (→ `EXPIRED`).
5. Zählende Slots (`RESERVED` nicht abgelaufen, `CAPTURING`, `UPLOADING`, `SUBMITTED`)
   zählen; `>= max_slots` → `CHALLENGE_FULL`.
6. Slot `RESERVED` mit `expires_at` anlegen (eigenen abgelaufenen Slot wiederverwenden);
   Challenge-Status konsistent auf `FULL`/`OPEN` setzen.
7. Nach dem Commit Event `challenge.slot_reserved` veröffentlichen.

Die `FOR UPDATE`-Sperre auf der Challenge-Row serialisiert konkurrierende Joins
derselben Challenge und garantiert das harte Limit von 10 Plätzen.

## HTTP-API

NestJS-App (`apps/api`), die die reinen Kernfunktionen als Endpoints exponiert. Der
Controller ist ein dünner Wrapper um `joinChallenge`; ein globaler Filter mappt
`AppError` auf `{ error: { code, message } }`.

| Methode & Pfad                 | Auth   | Zweck                                              |
| ------------------------------ | ------ | -------------------------------------------------- |
| `POST /v1/challenges/:id/join` | Bearer | Teilnehmerplatz reservieren (201, sonst 4xx-Code)  |
| `GET  /v1/challenges/:id`      | —      | Öffentlicher Zustand inkl. belegter Plätze         |
| `GET  /health`                 | —      | Liveness + DB-Erreichbarkeit                        |

**Auth:** `AuthGuard` liest `Authorization: Bearer <token>` und verifiziert es über
den `TokenVerifier`. Default ist der `MockTokenVerifier` (Token = User-ID, kein
Netzwerk/Credentials nötig) — ideal für Entwicklung/Tests. In Produktion wird hier
der `FirebaseTokenVerifier` eingehängt (App Check + Firebase Auth).

Fehlerbeispiele: `401` (Token fehlt/ungültig), `403 CREATOR_CANNOT_JOIN`,
`409 ALREADY_JOINED`, `409 CHALLENGE_FULL`, `400` (kein gültiges UUID-Format).

Starten: `pnpm --filter @vcp/api start` (Port aus `PORT`, Default 8080). Beispiel:

```sh
curl -s -X POST http://localhost:8080/v1/challenges/<id>/join \
  -H "Authorization: Bearer <user-id>"
```

## Slot-Expiration-Worker — Design

`expireSlots` gibt abgelaufene Reservierungen frei und macht dadurch volle
Challenges wieder beitretbar. Ohne diesen Sweep würden abgelaufene `RESERVED`-Slots
Plätze dauerhaft blockieren. Gleiche Bauweise wie `joinChallenge` (reine Funktion,
Row-Lock, Event nach Commit); pro betroffener Challenge eine eigene Transaktion:

1. Kandidaten ermitteln: Challenges mit `RESERVED`-Slots, deren `expires_at < now`.
2. Challenge-Row per `SELECT ... FOR UPDATE` sperren (keine Konkurrenz mit `joinChallenge`).
3. Abgelaufene `RESERVED`-Slots → `EXPIRED`.
4. Ist die Challenge `FULL` und nun `< max_slots` belegt: Status → `OPEN`.
5. Nach dem Commit Events `challenge.slots_expired` und ggf. `challenge.reopened`.

Ein Durchlauf ist idempotent. Runner: `pnpm --filter @vcp/api worker:expire`
(Dauerloop, alle 30s) bzw. `worker:expire -- --once` (einmalig, z. B. für
Cloud Scheduler / Cloud Tasks).

## Lokal ausführen

Voraussetzung: Node ≥ 20, pnpm 9, Docker (für PostgreSQL).

```sh
cp .env.example .env
pnpm install
pnpm db:up                       # PostgreSQL 16 via docker compose
pnpm prisma:generate             # Prisma-Client generieren
pnpm exec prisma migrate deploy  # Schema anwenden (oder: prisma db push)

# Unit-Tests (ohne DB): contracts, domain, config, api-Unit
pnpm test

# Integrationstests (mit DB): Concurrency-Nachweis + Expiration-Worker
pnpm --filter @vcp/api test:integration

# HTTP-e2e-Tests (mit DB): Endpoints inkl. Auth & Fehlercodes
pnpm --filter @vcp/api test:e2e

# API-Server starten (Port aus PORT, Default 8080):
pnpm --filter @vcp/api start

# Slot-Expiration-Worker starten (Dauerloop) bzw. einmalig:
pnpm --filter @vcp/api worker:expire
pnpm --filter @vcp/api worker:expire -- --once
```

### Definition of Done (`joinChallenge`)

Der Integrationstest (`apps/api/test/join-challenge.integration.test.ts`) belegt:
50 parallele authentifizierte Join-Requests → **exakt 10 Erfolge**, **40 ×
`CHALLENGE_FULL`**, keine doppelte Reservierung, Challenge-Status `FULL`, Daten
konsistent.

## Status

- Dies ist ein **fokussierter** Phase-0-Ausschnitt (die für `joinChallenge` nötigen
  Modelle + angrenzende Entitäten), nicht die vollständigen 31 Enums / 22 Modelle
  des Gesamtentwurfs.
- **Verifiziert:** In der Build-Umgebung wurden `pnpm install`, `prisma db push`,
  `tsc --noEmit` (alle Pakete) sowie die Tests tatsächlich ausgeführt:
  - Unit-Tests grün — contracts (2), domain (8), config (3).
  - Integrationstests gegen ein lokales PostgreSQL 16 grün (6 Tests): der
    Pflicht-Concurrency-Test (50 parallele Joins → exakt 10 Reservierungen,
    40 × `CHALLENGE_FULL`, Challenge `FULL`) sowie der Expiration-Worker
    (Freigabe abgelaufener Slots, `FULL` → `OPEN`, erneute Vergabe).
  - HTTP-e2e-Tests grün (8 Tests): join/get/health inkl. 201/400/401/403/404/409.
  - Der API-Server wurde live gestartet und per `curl` geprüft: `GET /health`
    (`db:up`), `POST …/join` (201), Wiederholung (409 `ALREADY_JOINED`), Ersteller
    (403), ohne Token (401).

## Nächste Schritte

1. `FirebaseTokenVerifier` (App Check + Firebase Auth) statt `MockTokenVerifier`
   in `AuthModule` einhängen; Provider-Auswahl über Env/Flag.
2. Challenge-Erstellung + Vollfinanzierung (Stripe-Testmodus, Webhook als einzige
   Publish-Quelle) — bis dahin werden Challenges direkt in der DB angelegt.
3. Phase 1: Challenge-Erstellungs-Wizard, Admin-Moderationsqueue, Discover.
