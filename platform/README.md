# Video-Challenge-Plattform

Bezahlte Video-Challenge-Plattform, mobile-first. Startmarkt Deutschland, EUR,
ausschließlich 18+. Umsetzung nach dem verbindlichen Build-Auftrag
`FABLE_CLOUD_START_HERE_Challenge_Platform.md`.

> Code und Identifier sind Englisch; alle nutzersichtbaren Texte und Fehlermeldungen
> sind Deutsch. Geldbeträge ausschließlich als Integer in Cent. Timestamps in UTC,
> IDs als UUID. Alle Feature-Flags default `false`.

## Umsetzungsstand gegenüber der Spezifikation

Der **fachliche Kern-Loop** und alle **nicht verhandelbaren Produktregeln** sind
umgesetzt und getestet; das Gesamtdokument ist breiter (volle Video-Pipeline,
Mobile-App, Firebase-Live etc.). Ehrliche Einordnung:

**Nicht verhandelbare Regeln — umgesetzt & getestet:**
max. 10 zählende Plätze (transaktionssicher, `FOR UPDATE`, 50-parallel-Test → exakt 10);
Veröffentlichung nur nach bestätigter Vollfinanzierung (Webhook als einzige Quelle);
genau ein vorab fixierter Auswahlmodus; eine Einsendung pro Nutzer; Ersteller kann nicht
gewinnen/abstimmen; unveränderliche Winner-Decision (`UNIQUE(challenge_id)`, atomar,
parallel-sicher) **+ revisionssicheres `audit_logs` (append-only per DB-Trigger)**;
idempotente Zahlung/Auszahlung/Erstattung mit doppelter, unveränderlicher Buchführung;
`AUTO_FALLBACK` bei Ersteller-Untätigkeit (höchster Score, Tie-Break früheste
`finalized_at`); Moderationsfreigabe (`APPROVED`) als Gewinn-/Veröffentlichungs­bedingung;
keine Echtgeld-Produktion, solange Flags `false` (Factory wirft hart).

**Phase 0 (10-Punkte-Auftrag) — Status:**

| # | Punkt | Status |
|---|-------|--------|
| 1 | Monorepo (pnpm + Turborepo) | ✅ |
| 2 | apps: api / admin-web / workers / mobile | ✅ api + admin + web + **mobile (Expo SDK 57)** + `apps/workers` |
| 3 | TypeScript, Tests, Env-Validierung / Linting | ✅ TS/Tests/Zod-Env/ESLint (Flat-Config, in CI) |
| 4 | Vollständiges Prisma-Modell + erste Migration | ⚠️ Kernmodelle + `audit_logs`/`ledger_entries`/`votes`/`payouts`/`challenge_criteria`/`reports`/`evidence_assets`; **fehlend:** profiles, transfers, connected_accounts, moderation_cases, comments/likes/follows, notifications |
| 5 | Firebase-Auth + App-Check | ⚠️ `FirebaseTokenVerifier` (Mock-Default) vorhanden; **App-Check fehlt** |
| 6 | Challenge-State-Machine | ✅ (Status-Namen weichen vom Dokument ab — s. offene Punkte) |
| 7 | Transaktionssichere `join`-Logik | ✅ |
| 8 | 50-Nutzer-Concurrency-Test → exakt 10 | ✅ grün |
| 9 | Mock-Payment-Provider | ✅ (+ Stripe-Provider-Code, per Env wählbar) |
| 10 | README-Dokumentation | ✅ (dieses Dokument) |

**In-App-Beweisaufnahme (Kernregel) — umgesetzt hinter `LONG_CAPTURE_ENABLED`:**
Capture-Intent-API (`POST /v1/challenges/:id/evidence-intent`) + `evidence_assets`-Tabelle
+ `EvidenceStorageProvider`-Abstraktion (Mock-Default **plus S3-kompatibler Provider mit
presignter PUT-URL**, `STORAGE_PROVIDER=s3`) + In-App-Recorder in Web (`getUserMedia`/
`MediaRecorder`) und Mobile (`expo-camera`), jeweils **ohne** Datei-/Galeriezugriff. Bei
aktivem Flag ist ein gültiger, zur Teilnahme gehörender `evidenceRef` Pflicht — es gibt
keinen Pfad, der eine beliebige Datei akzeptiert (kein Galerieimport). Ohne Flag bleibt es
beim bisherigen Stub. Echtes Transcoding/Overlay/Hash-Kette bleibt der externen
Medienpipeline vorbehalten.

**Moderations-Loop in der UI:** Melden (`POST /v1/reports`) im Web, priorisierte
Admin-Queue mit Statuswechsel (`PATCH /v1/reports/:id`, terminale Zustände) im Admin.

**Offene Punkte / bewusste Abweichungen:**
- Status-Namen weichen vom Dokument ab (z. B. `PENDING_FUNDING`/`OPEN`/`WINNER_LOCKED`
  vs. `PAYMENT_PENDING`/`FUNDED`/`JUDGING`/`VOTING`). Regeln/Verhalten identisch;
  Umbenennung ist ein reines Refactoring (auf Wunsch angleichbar).
- Echtes Firebase/App-Check und Stripe-Live sowie ein echter Medien-Storage (Transcoding,
  Overlay, Hash-Kette) und die Mobile-App erfordern externe Dienste/Credentials — bewusst
  hinter Interfaces/Flags vorbereitet, aber nicht live.
- Weitere Spec-Tabellen (Social/Payments-Detail, moderation_cases) sind noch nicht angelegt.

**Testresultate (in dieser Umgebung real ausgeführt, gegen migrierte PostgreSQL 16):**
Unit + Integration + e2e grün; Pflicht-Concurrency-Test (50→10), Gewinner-Race
(genau eine Decision), Webhook-Idempotenz, Cancel/Refund, Deadline-/Expiration-Worker,
Ledger- und Audit-Immutability. CI (GitHub Actions) grün.

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
  payments/   PaymentProvider + MockPaymentProvider (idempotent) + Factory-Guard
apps/
  api/
    src/main.ts                              # NestJS-Bootstrap (Port aus @vcp/config)
    src/app.module.ts                        # Wurzelmodul
    src/challenges/challenges.controller.ts  # POST /v1/challenges/:id/join, GET /v1/challenges/:id
    src/challenges/join-challenge.ts         # reine, transaktionssichere Slot-Reservierung
    src/challenges/create-challenge.ts       # erstellen (PENDING_FUNDING) + Funding-Absicht
    src/challenges/close-submissions.ts      # Einsendungsphase schließen
    src/challenges/select-winner.ts          # Gewinnerauswahl (CREATOR/COMMUNITY/FALLBACK)
    src/challenges/join-challenge.handler.ts # framework-agnostischer HTTP-Adapter
    src/submissions/*                        # submit / moderate / vote (+ Controller)
    src/funding/confirm-funding.ts           # Webhook: Vollfinanzierung → OPEN
    src/funding/process-payout.ts            # idempotente, flag-gesicherte Auszahlung
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
`AppError` auf `{ error: { code, message } }`. Eine vollständige, importierbare
OpenAPI-3.1-Spezifikation liegt unter [`docs/openapi.yaml`](docs/openapi.yaml).

| Methode & Pfad                          | Auth    | Zweck                                                  |
| --------------------------------------- | ------- | ------------------------------------------------------ |
| `POST /v1/users`                        | —       | Registrierung (18+-Gate); ID dient als Bearer-Token     |
| `GET  /v1/users/me`                     | Bearer  | Eigenes Profil                                          |
| `GET  /v1/users/me/challenges`          | Bearer  | Eigene erstellte + beigetretene Challenges              |
| `POST /v1/challenges`                   | Bearer  | Challenge erstellen (`PENDING_FUNDING`) + Funding-Absicht |
| `POST /v1/challenges/:id/join`          | Bearer  | Teilnehmerplatz reservieren (201, sonst 4xx-Code)      |
| `POST /v1/challenges/:id/evidence-intent` | Bearer | In-App-Aufnahme-Upload anfordern (nur `LONG_CAPTURE_ENABLED`, sonst 404) |
| `POST /v1/challenges/:id/submit`        | Bearer  | Einsendung abgeben (Beweis-Ref Pflicht bei aktiver Aufnahme, sonst Stub) |
| `POST /v1/challenges/:id/vote`          | Bearer  | Community-Stimme abgeben                                |
| `POST /v1/submissions/:id/moderate`     | Admin   | Einsendung freigeben/ablehnen                           |
| `POST /v1/challenges/:id/close`         | Admin   | Einsendungsphase schließen                              |
| `POST /v1/challenges/:id/select-winner` | Bearer  | Gewinner wählen (Ersteller) / Fallback (Admin)          |
| `POST /v1/challenges/:id/cancel`        | Bearer  | Abbrechen (+ idempotente Erstattung, falls finanziert)  |
| `POST /v1/challenges/:id/payout`        | Admin   | Idempotente Auszahlung (Geldfluss nur bei `PAYOUTS_ENABLED`) |
| `GET  /v1/challenges`                   | —       | Liste (optional `?status=`), für Discover/Admin         |
| `GET  /v1/challenges/:id`               | —       | Öffentlicher Zustand inkl. belegter Plätze             |
| `GET  /v1/challenges/:id/submissions`   | Bearer  | Einsendungen + Stimmenzahl (Moderation/Auswahl)         |
| `GET  /v1/feed`                         | —       | Öffentlicher Feed entschiedener Challenges (`PUBLIC_FEED_ENABLED`) |
| `POST /v1/reports`                      | Bearer  | Inhalt/Konto melden (Priorität aus Grund abgeleitet)    |
| `GET  /v1/reports`                      | Admin   | Moderations-/Meldungs-Queue                             |
| `PATCH /v1/reports/:id`                 | Admin   | Bearbeitungsstatus setzen (OPEN→REVIEWING→RESOLVED/DISMISSED) |
| `POST /v1/webhooks/payments`            | Secret/Sig | Vollfinanzierung bestätigen → veröffentlichen (idempotent) |
| `GET  /v1/config`                       | —       | Öffentliche Feature-Flags für die Frontends (keine Secrets) |
| `GET  /health`                          | —       | Liveness + DB-Erreichbarkeit                            |

**Admin:** Im Mock-Verifier markiert das Token-Präfix `admin:` (z. B. `Bearer admin:<uuid>`)
einen Admin — nur Entwicklung/Tests, ersetzt später Firebase-Claims.

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

## Finanzierung & Veröffentlichung

Eine Challenge wird **nicht** offen erstellt. Der Lebenszyklus:

1. `POST /v1/challenges` legt sie in `PENDING_FUNDING` an, fixiert Auswahlmodus,
   Preis und Frist und erzeugt über den `PaymentProvider` eine Finanzierungs-Absicht
   (Escrow der Preissumme, Betrag in Cent). Antwort enthält `funding.clientSecret`.
2. Nach Zahlung liefert der Provider einen **Webhook** an `POST /v1/webhooks/payments`
   (Secret-geprüft). `confirmFunding` ist die **einzige** Veröffentlichungsquelle —
   niemals eine Client-Erfolgsmeldung. In **einer** Transaktion (Row-Lock der
   Challenge): Betrag prüfen, Finanzierung `CONFIRMED`, doppelte Buchung ins
   **unveränderliche** Ledger, Challenge `PENDING_FUNDING` → `OPEN`.
3. Erst jetzt greift `joinChallenge`.

Der Webhook ist **idempotent**: erneute Zustellung ist ein No-Op (keine doppelten
Buchungen). Geld bewegt sich ausschließlich über idempotente Backend-Prozesse; das
Ledger ist per DB-Trigger (`prisma/sql/immutability.sql`) gegen UPDATE/DELETE
gesperrt. Echtgeld bleibt deaktiviert: `createPaymentProvider` liefert den
`MockPaymentProvider` und wirft hart, sobald `REAL_MONEY_ENABLED=true` ohne
Live-Anbindung gesetzt wird.

## Gewinnerauswahl & Auszahlung (Geld-raus-Loop)

Nach dem Beitritt: `submit` (Einsendung, Stub) → optional `vote` → Admin `moderate`
(nur `APPROVED` ist gewinnberechtigt) → Admin `close` (`SUBMISSIONS_CLOSED`) →
`select-winner` → `payout`.

`selectWinner` ist der Kern (Rules 4–7) und läuft **atomar** unter Row-Lock:

- **Genau eine** Winner-Decision pro Challenge (`UNIQUE(challenge_id)`); erneuter
  Aufruf ist idempotent, auch bei zwei parallelen Aufrufen entsteht nur eine.
- Ablauf: prüfen → Decision → Submissions `WINNER`/`LOSER` → Challenge
  `WINNER_LOCKED` → Payout-Datensatz → doppelte Ledger-Buchung (Escrow → Winner).
- Quellen: `CREATOR_DECIDES` (Ersteller wählt eine `APPROVED`-Einsendung),
  `COMMUNITY_VOTE` (höchster Score), `AUTO_FALLBACK` (Admin bei Ersteller-Untätigkeit:
  höchster Community-Score, Tie-Break früheste `finalized_at`).

`processPayout` ist idempotent und **flag-gesichert**: bei `PAYOUTS_ENABLED=false`
wird der Payout nur auf `HELD` gesetzt (kein Geldfluss, Challenge bleibt
`WINNER_LOCKED`); bei `true` wird er als `PAID` verbucht und die Challenge geht auf
`PAID_OUT`.

`cancelChallenge` schließt die Gegenrichtung des Geldflusses: ein Abbruch vor
Einsendeschluss (Ersteller oder Admin) setzt die Challenge auf `CANCELLED`, gibt
zählende Slots frei und erstattet — falls bereits vollfinanziert — die Preissumme
idempotent per doppelter Ledger-Rückbuchung (`funding.status = REFUNDED`).

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
# Ledger-Immutability-Trigger anwenden (prisma db push erzeugt keine Trigger):
psql "$DATABASE_URL" -f prisma/sql/immutability.sql

# Unit-Tests (ohne DB): contracts, domain, config, api-Unit
pnpm test

# Integrationstests (mit DB): Concurrency-Nachweis + Expiration-Worker
pnpm --filter @vcp/api test:integration

# HTTP-e2e-Tests (mit DB): Endpoints inkl. Auth & Fehlercodes
pnpm --filter @vcp/api test:e2e

# API-Server starten (Port aus PORT, Default 8080):
pnpm --filter @vcp/api start

# Hintergrund-Worker (eigene App `apps/workers`; Dauerloop, `-- --once` = ein Durchlauf):
pnpm --filter @vcp/workers worker:expire   # abgelaufene Reservierungen freigeben
pnpm --filter @vcp/workers worker:close    # Einsendungen abgelaufener Challenges schließen
pnpm --filter @vcp/workers worker:all      # beide Sweeps pro Durchlauf
```

### Definition of Done (`joinChallenge`)

Der Integrationstest (`apps/api/test/join-challenge.integration.test.ts`) belegt:
50 parallele authentifizierte Join-Requests → **exakt 10 Erfolge**, **40 ×
`CHALLENGE_FULL`**, keine doppelte Reservierung, Challenge-Status `FULL`, Daten
konsistent.

## Admin-UI (`apps/admin`)

Next.js-14-Oberfläche (App Router) für Moderation, Gewinnerauswahl, Auszahlung und
Abbruch. Sie spricht ausschließlich die API — API-Basis-URL und Admin-Token
(`admin:<uuid>` im Mock-Setup) werden in der Oberfläche hinterlegt (localStorage).

```sh
pnpm --filter @vcp/admin dev     # http://localhost:3000
pnpm --filter @vcp/admin build   # Produktions-Build
```

Seiten: Dashboard mit Status-gefilterter Challenge-Liste (`GET /v1/challenges`) und
eine Detailseite mit Einsendungen (`GET /v1/challenges/:id/submissions`) samt
Freigeben/Ablehnen, Einsendeschluss, Gewinnerwahl, Auszahlung und Abbruch.

## Web-Frontend (`apps/web`)

Öffentliche Teilnehmer-/Ersteller-Oberfläche (Next.js 14, App Router), **mobile-first**
und Launch-tauglich gestaltet (globale Kopfleiste mit Navigation + Session, farbcodierte
Status-Badges, Slot-Fortschritt, Dark-Mode über `color-scheme`). Der komplette
Nutzer-Weg ohne Admin:

- **Registrieren** mit 18+-Gate (die zurückgegebene ID dient als Bearer-Token).
- **Entdecken:** offene Challenges + optionaler Gewinner-Feed (`GET /v1/feed`, hinter Flag).
- **Erstellen:** Titel/Beschreibung/Kategorie/Preisgeld/Auswahlmodus/Frist; danach klarer
  Hinweis, dass die Veröffentlichung **allein** an der per Webhook bestätigten
  Vollfinanzierung hängt (keine Client-Erfolgsmeldung).
- **Teilnehmen:** beitreten, In-App-Beweis einreichen; eigener Slot-/Einsendungsstatus wird
  angezeigt (`GET /v1/users/me/challenges`).
- **Ersteller-Selfservice** direkt in der Web-App: Einsendeschluss setzen, Gewinner festlegen
  (bei `CREATOR_DECIDES` per Auswahl unter freigegebenen Einsendungen; bei `COMMUNITY_VOTE`
  aus den Stimmen ermittelt) und Abbrechen. Moderation und Auszahlung bleiben bewusst dem
  Admin-Bereich vorbehalten.
- **Community-Voting** für freigegebene Einsendungen.

```sh
pnpm --filter @vcp/web dev       # http://localhost:3001
pnpm --filter @vcp/web build     # Produktions-Build
```

Beide Frontends sprechen ausschließlich die API. Die API-Basis wird für den Launch per
`NEXT_PUBLIC_API_BASE` (Build-Zeit) gesetzt; ohne Vorgabe greift `http://localhost:8080`,
und das Web-Frontend erlaubt zusätzlich eine manuelle Override (localStorage) zum Testen.
Die Frontend-Origins müssen in `CORS_ORIGINS` der API freigegeben sein (lokal z. B.
`http://localhost:3000,http://localhost:3001`).

## Mobile-App (`apps/mobile`)

Native Teilnehmer-App (Expo SDK 57, expo-router, React Native 0.86) — Details und
Setup in [`apps/mobile/README.md`](apps/mobile/README.md). Bildet den vollständigen
Nutzer-Weg ab (Registrieren 18+, Entdecken, Beitreten, Voting, Melden, Ersteller-
Selfservice, Challenge erstellen) und liefert die **In-App-Beweisaufnahme über die
Gerätekamera** (`expo-camera`, Video, **ohne** Galerie-/Dateizugriff) — hinter
`LONG_CAPTURE_ENABLED` mit `evidence-intent` → Aufnahme → Einreichen.

Bewusst **aus dem pnpm-Workspace ausgenommen** (`!apps/mobile`): die Expo-Toolchain
verwaltet eigene Abhängigkeiten/Lockfile (npm), der Web-CI-Install bleibt unverändert.
API-Basis via `EXPO_PUBLIC_API_BASE`. Verifiziert: `tsc` grün, Metro-Web-Export grün
(~820 Module); native Laufzeit/Kamera erfordert Gerät/Simulator (EAS-Build).

## Provider-Auswahl (Auth & Payments)

Auth und Zahlungen laufen hinter austauschbaren Interfaces; die Auswahl steuert das
Env, Default ist jeweils der Mock (kein Netzwerk/keine Credentials):

- `AUTH_PROVIDER=mock|firebase` — `firebase` bindet `FirebaseTokenVerifier`
  (`firebase-admin`, ADC via `GOOGLE_APPLICATION_CREDENTIALS`, Admin über Custom-Claim
  `admin`) und braucht `FIREBASE_PROJECT_ID`.
- `PAYMENTS_PROVIDER=mock|stripe` — `stripe` bindet `StripePaymentProvider`
  (PaymentIntents, idempotent) und `StripeWebhookVerifier` (Signaturprüfung über den
  Raw-Body) und braucht `STRIPE_SECRET_KEY` (+ `STRIPE_WEBHOOK_SECRET` für Webhooks).
- `STORAGE_PROVIDER=mock|s3` — Evidence-Storage der In-App-Aufnahme. `s3` bindet den
  `S3EvidenceStorageProvider`, der eine **presignte PUT-URL** (AWS Signature V4,
  handgeschrieben über `node:crypto`, **ohne SDK**) liefert; die App lädt die Aufnahme
  direkt in den Bucket. S3-kompatibel (AWS S3, Cloudflare R2, MinIO, Backblaze B2) via
  `STORAGE_S3_ENDPOINT/REGION/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY`
  (`STORAGE_S3_FORCE_PATH_STYLE` für MinIO). Die SigV4-Signatur ist per
  offiziellem AWS-Known-Answer-Test verifiziert.

Auth und Zahlungen laden ihre SDKs **lazy** — Mock-Betrieb und Tests brauchen sie nicht.
Live-Betrieb erfordert nur, die jeweiligen Secrets als Umgebungsvariablen zu hinterlegen.

## CI

`.github/workflows/ci.yml` läuft bei jedem Push/PR (Pfad `platform/**`): Installation,
`prisma generate` + `migrate deploy` gegen einen PostgreSQL-16-Service, **ESLint**
(`pnpm exec eslint .`), `tsc` über alle Pakete, Unit-/Integration-/e2e-Tests und die
Builds von `apps/admin` und `apps/web`.

## Sicherheit & Launch-Härtung

Der API-Server ist für den Produktivbetrieb gehärtet (alles im `main.ts`-Bootstrap):

- **Security-Header** via `helmet` (CSP, HSTS, `X-Content-Type-Options`, `X-Frame-Options`, …).
- **CORS-Allowlist** über `CORS_ORIGINS` (kommagetrennt; leer = keine Cross-Origin-Freigabe,
  `*` nur für Entwicklung). Fremde Origins erhalten keinen `Access-Control-Allow-Origin`.
- **Rate-Limiting** (`@nestjs/throttler`) pro IP: `RATE_LIMIT_MAX`/`RATE_LIMIT_TTL_MS`
  global, strenger auf `POST /v1/users` (20/min). Hinter Proxy via `trust proxy`.
- **Request-ID + strukturierte Logs**: jede Antwort trägt `x-request-id`; Zugriffe
  werden mit Methode/Pfad/Status/Dauer als JSON protokolliert.
- **Graceful Shutdown** (`enableShutdownHooks`) — Prisma trennt sauber (Cloud-Run-SIGTERM).
- **Produktions-Guards**: in `NODE_ENV=production` verweigert der Start ein Default-
  `WEBHOOK_SECRET` (Fail-Fast); Mock-Auth/-Payments werden als Warnung protokolliert.

## Deployment

Ein Container-Image (`Dockerfile`) bedient alle Prozesse (API, Worker, Migration) —
der Prozess wird über das `command` gewählt. Vollständiger lokaler Stack:

```sh
docker compose -f docker-compose.app.yml up --build   # API auf :8080, migrate-Job + Worker
```

Der produktive Migrations-Pfad ist `prisma migrate deploy` (die handgeschriebene
Migration erzeugt inkl. Ledger-Immutability-Trigger ein produktionsgleiches Schema).
Details und eine Cloud-Run-Skizze: [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Status

- Dies ist ein **fokussierter** Phase-0-Ausschnitt (die für `joinChallenge` nötigen
  Modelle + angrenzende Entitäten), nicht die vollständigen 31 Enums / 22 Modelle
  des Gesamtentwurfs.
- **Verifiziert:** In der Build-Umgebung wurden `pnpm install`, `prisma db push`,
  `tsc --noEmit` (alle Pakete) sowie die Tests tatsächlich ausgeführt — **77 Tests grün**:
  - Unit (30) — contracts (2), domain (8), config (8), payments (12); api-Unit (3).
  - Integration gegen lokales PostgreSQL 16 (22): Pflicht-Concurrency-Test
    (50 parallele Joins → exakt 10), Expiration- und Fristen-Worker,
    Finanzierungs-Lebenszyklus inkl. Ledger-Immutability, der Geld-raus-Loop
    (submit → moderate → close → select → payout) mit allen drei Auswahlquellen und
    paralleler Winner-Lock-Sicherheit, sowie Abbruch + idempotente Erstattung.
  - HTTP-e2e (22): Onboarding (18+-Gate), join/get/health, create→Webhook→join,
    der volle Geld-raus-Loop, Abbruch, Read-/Feed-Endpoints.
  - Live geprüft: Security-Header (helmet), `x-request-id`, CORS-Allowlist,
    Rate-Limit (429 nach 20 Registrierungen) und der Prod-Secret-Guard (Fail-Fast).
  - Live per `curl` geprüft: **voll self-serve ohne DB-Seeding** — Nutzer registrieren
    → erstellen → Webhook-Funding → beitreten; sowie der komplette Geld-raus-Loop bis
    `WINNER_LOCKED` und zurückgehaltener Auszahlung.
  - **Deploy-Pfad geprüft:** `prisma migrate deploy` gegen PostgreSQL 16 (Migration inkl.
    Trigger), gesamte Test-Suite grün gegen die **migrierte** DB; alle Container-Commands
    (`start`, `worker:expire`/`worker:close --once`, `migrate deploy`) direkt verifiziert.
    Der Docker-Image-Build selbst wurde mangels Daemon in dieser Umgebung nicht ausgeführt.

## Was fehlt bis „produktiv" (externe Abhängigkeiten)

Der **komplette fachliche Kern-Loop** ist implementiert und getestet. Für den
Produktivbetrieb fehlen v. a. Stränge mit externen Abhängigkeiten oder Freigaben:

1. `FirebaseTokenVerifier` (App Check + Firebase Auth) statt `MockTokenVerifier` —
   braucht Firebase-Projekt/Credentials.
2. Einsendungs-Pipeline (In-App-Capture, Upload, Transcoding) — braucht GCS/Transcoder;
   aktuell ist die Einsendung als Datensatz modelliert (kein echtes Video).
3. Echter `PaymentProvider` (Stripe Connect, Testmodus): Transfer/Refund,
   Webhook-Signaturprüfung, Payout-Ausführung — hinter den `false`-Flags.
4. Produktoberflächen: Admin-Moderationsqueue, Discover, Social Feed (Phasen 1/6/7),
   Mobile-App (Expo).
