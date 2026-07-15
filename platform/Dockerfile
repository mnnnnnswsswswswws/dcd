# syntax=docker/dockerfile:1
#
# Ein Image für alle Prozesse (API + Worker + Migration). Der auszuführende Prozess
# wird über `command` gewählt (siehe docker-compose.app.yml). Die App läuft via `tsx`
# direkt aus dem TypeScript-Quelltext — konsistent zu Tests und lokalem Betrieb.
FROM node:22-slim AS base

# OpenSSL wird von der Prisma Query Engine benötigt.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable
WORKDIR /app

# Manifeste zuerst kopieren — bessere Layer-Cache-Ausnutzung bei Code-Änderungen.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/payments/package.json packages/payments/package.json
COPY prisma prisma

# Dev-Abhängigkeiten werden zur Laufzeit gebraucht (tsx als Runner, prisma CLI).
RUN pnpm install --frozen-lockfile --prod=false

# Restlichen Quelltext kopieren und Prisma-Client generieren.
COPY . .
RUN pnpm exec prisma generate

ENV PORT=8080
EXPOSE 8080

# Liveness/Readiness: /health prüft zusätzlich die DB-Erreichbarkeit.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Default-Prozess: API-Server. Worker/Migration via abweichendem command.
CMD ["pnpm", "--filter", "@vcp/api", "start"]
