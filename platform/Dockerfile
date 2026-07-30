# syntax=docker/dockerfile:1
#
# Ein Image für alle Prozesse (API + Frontends + Worker + Migration). Der
# auszuführende Prozess wird über `command`/`args` gewählt (siehe
# docker-compose.app.yml und infrastructure/terraform/cloud-run.tf). Die
# Server-Prozesse laufen via `tsx` direkt aus dem TypeScript-Quelltext — konsistent
# zu Tests und lokalem Betrieb.
FROM node:22-slim AS base

# OpenSSL wird von der Prisma Query Engine benötigt.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable
WORKDIR /app

# Manifeste zuerst kopieren — bessere Layer-Cache-Ausnutzung bei Code-Änderungen.
#
# Hier muss **jedes** Workspace-Paket stehen, sonst installiert pnpm dessen
# Abhängigkeiten nicht: Die Symlinks entstehen zwar trotzdem und werden durch das
# spätere `COPY . .` gültig, aber die Pakete selbst blieben ohne node_modules. Ein
# Test in packages/capacity vergleicht diese Liste gegen pnpm-workspace.yaml und
# schlägt fehl, wenn ein neues Paket hier fehlt.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY apps/admin/package.json apps/admin/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/workers/package.json apps/workers/package.json
COPY packages/ai-governance/package.json packages/ai-governance/package.json
COPY packages/cache/package.json packages/cache/package.json
COPY packages/capacity/package.json packages/capacity/package.json
COPY packages/compliance/package.json packages/compliance/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/moderation/package.json packages/moderation/package.json
COPY packages/outbox/package.json packages/outbox/package.json
COPY packages/payments/package.json packages/payments/package.json
COPY packages/wellbeing/package.json packages/wellbeing/package.json
COPY prisma prisma

# Dev-Abhängigkeiten werden zur Laufzeit gebraucht (tsx als Runner, prisma CLI).
RUN pnpm install --frozen-lockfile --prod=false

# Restlichen Quelltext kopieren und Prisma-Client generieren.
COPY . .
RUN pnpm exec prisma generate

# Die Next.js-Frontends brauchen einen Build; `next start` ohne `.next` scheitert.
#
# `NEXT_PUBLIC_API_BASE` wird zur **Build-Zeit** in das Bundle eingebettet (siehe
# apps/web/lib/api.ts). Sie kann deshalb nicht über eine Umgebungsvariable des
# Cloud-Run-Dienstes nachgereicht werden — sie muss hier stehen. Beim allerersten
# Deploy ist die API-URL noch unbekannt; das Runbook beschreibt den zweistufigen
# Weg (docs/runbooks/DEPLOY_GCP.md).
ARG NEXT_PUBLIC_API_BASE=""
ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE
RUN pnpm --filter @vcp/web build && pnpm --filter @vcp/admin build

ENV PORT=8080
EXPOSE 8080

# Liveness/Readiness: /health prüft zusätzlich die DB-Erreichbarkeit.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Default-Prozess: API-Server. Frontends/Worker/Migration via abweichendem command.
CMD ["pnpm", "--filter", "@vcp/api", "start"]
