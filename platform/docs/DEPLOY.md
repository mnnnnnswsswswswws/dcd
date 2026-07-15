# Deployment

Ein Container-Image (`Dockerfile`) bedient alle Prozesse; der auszuführende Prozess
wird über das `command` gewählt:

| Prozess           | Command                                          | Betrieb                          |
| ----------------- | ------------------------------------------------ | -------------------------------- |
| API-Server        | `pnpm --filter @vcp/api start`                   | langlaufend, hört auf `PORT`     |
| Migration         | `pnpm exec prisma migrate deploy`                | einmalig vor Rollout             |
| Slot-Worker       | `pnpm --filter @vcp/api worker:expire -- --once` | periodisch (Scheduler)           |
| Fristen-Worker    | `pnpm --filter @vcp/api worker:close -- --once`  | periodisch (Scheduler)           |

Die App liest ihre Konfiguration ausschließlich aus Umgebungsvariablen (siehe
`.env.example` und `packages/config`). Alle Feature-Flags sind default `false`;
`REAL_MONEY_ENABLED=true` ohne echten Provider lässt den Start hart fehlschlagen.

## Lokal (vollständiger Stack)

```sh
docker compose -f docker-compose.app.yml up --build
# API: http://localhost:8080/health
```

Der `migrate`-Job läuft einmalig vor `api`/Workern und wendet die Migration inkl.
Ledger-Immutability-Trigger an. Für reinen DB-Betrieb während der Entwicklung genügt
weiterhin `docker-compose.yml` (`pnpm db:up`) plus lokalem `pnpm start`.

## Cloud Run (Skizze)

1. **Image bauen & pushen** (Artifact Registry):
   ```sh
   gcloud builds submit --tag REGION-docker.pkg.dev/PROJECT/vcp/api:TAG
   ```
2. **Migration** als einmaliger Cloud Run Job (gleiches Image, überschriebenes
   command `pnpm exec prisma migrate deploy`), ausgeführt vor jedem Rollout.
3. **API** als Cloud Run Service. Cloud Run setzt `PORT` — `main.ts` liest ihn.
   Env/Secrets über Secret Manager: `DATABASE_URL` (Cloud SQL Connector),
   `WEBHOOK_SECRET`, Feature-Flags. Health-Check: `GET /health`.
4. **Worker** als Cloud Run Jobs, per Cloud Scheduler getriggert (command mit
   `-- --once`, damit ein Durchlauf läuft und der Job endet):
   - `worker:expire` — abgelaufene Slot-Reservierungen freigeben,
   - `worker:close` — Einsendungen abgelaufener Challenges schließen.

## Verifikationsstand

- `prisma migrate deploy` wurde in der Build-Umgebung gegen PostgreSQL 16 ausgeführt;
  die Migration erzeugt inkl. Immutability-Trigger ein produktionsgleiches Schema, und
  die vollständige Test-Suite (Integration + e2e) läuft grün gegen die **migrierte** DB.
- Die Container-Commands (`start`, `worker:expire`, `worker:close`,
  `prisma migrate deploy`) wurden jeweils direkt verifiziert.
- Der Docker-**Image-Build** selbst wurde in dieser Umgebung nicht ausgeführt (kein
  Docker-Daemon verfügbar); das `Dockerfile` folgt Standard-Node/pnpm-Praxis.
