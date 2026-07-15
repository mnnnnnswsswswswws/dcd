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
    src/challenges/join-challenge.ts         # aktive Aufgabe: reine, transaktionssichere Funktion
    src/challenges/join-challenge.handler.ts # framework-agnostischer HTTP-Adapter
    src/events/event-publisher.ts            # EventPublisher-Kontrakt + In-Memory/Logging-Impl
    test/join-challenge.integration.test.ts  # Pflichttest: 50 parallele Joins → exakt 10 Plätze
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

# Pflicht-Integrationstest (mit DB): Concurrency-Nachweis
pnpm --filter @vcp/api test:integration
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
  - Integrationstest gegen ein lokales PostgreSQL 16 grün (3 Tests), inklusive des
    Pflicht-Concurrency-Tests: 50 parallele Joins → exakt 10 Reservierungen,
    40 × `CHALLENGE_FULL`, Challenge `FULL`, keine doppelte Reservierung.

## Nächste Schritte

1. Slot-Expiration-Worker (abgelaufene Slots freigeben, `FULL` → `OPEN`).
2. Phase 1: Challenge-Erstellungs-Wizard, Admin-Moderationsqueue.
