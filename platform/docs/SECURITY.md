# Sicherheit

Dieses Dokument beschreibt die Sicherheitsarchitektur der Plattform, die aktiven
Härtungsmaßnahmen und den bewusst getrackten Restrisiko-Stand.

## Grundprinzipien

- **Kein Vertrauen in den Client.** Zustandsübergänge mit Geld-/Gewinner-Bezug
  entstehen ausschließlich serverseitig. Die Veröffentlichung einer Challenge wird
  **nur** durch einen verifizierten Zahlungs-Webhook ausgelöst, nie durch eine
  Client-Erfolgsmeldung.
- **Alle Eingaben werden validiert** (zod-Schemata in `packages/config` und pro
  Endpunkt). Beträge sind Integer in Cent, streng als positive Safe-Integer geprüft.
- **Revisionssichere Buchführung.** `ledger_entries` und `audit_logs` sind append-only;
  Updates/Deletes werden per DB-Trigger (`prisma/sql/immutability.sql`) hart abgelehnt.
- **Feature-Flags default aus.** `REAL_MONEY_ENABLED=true` ohne echten Provider lässt
  den Start hart fehlschlagen (kein versehentlicher Echtgeld-Betrieb).

## Transport & HTTP-Header

Beide Frontends (`apps/web`, `apps/admin`) setzen über `next.config.mjs`:

| Header | Wert | Zweck |
| --- | --- | --- |
| `Content-Security-Policy` | `default-src 'self'` … `frame-ancestors 'none'`, `object-src 'none'`, `form-action 'self'` | XSS-/Injection-/Clickjacking-Schutz |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | Erzwingt HTTPS (2 Jahre) |
| `X-Content-Type-Options` | `nosniff` | Kein MIME-Sniffing |
| `X-Frame-Options` | `DENY` | Kein Framing (Legacy-Ergänzung zu CSP) |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Kein Referer-Leak |
| `Permissions-Policy` | Web: `camera=(self) microphone=(self)`, sonst aus; Admin: alles aus | Minimale Geräte-Berechtigungen |

`poweredByHeader` ist aus (kein `X-Powered-By`-Fingerprint). Die API nutzt zusätzlich
`helmet()`.

## Authentifizierung & Autorisierung

- Auth über `AUTH_PROVIDER` — `mock` (nur Entwicklung/Tests) oder `firebase` (Produktion,
  echte Token-Verifikation). In Produktion warnt der Bootstrap bei `mock` laut.
- Admin-Rechte werden aus dem verifizierten Token abgeleitet (`isAdmin`), nie aus
  Client-Angaben.
- Optionaler App-Check-Guard (`APP_CHECK_ENABLED`) verlangt einen gültigen
  `x-firebase-appcheck`-Header.

## Zahlungs-Webhooks

- Verifikation provider-agnostisch (`packages/payments`). Der Mock-Verifier vergleicht
  das gemeinsame Secret **timing-safe** (SHA-256 + `crypto.timingSafeEqual`) — die
  Laufzeit verrät weder Inhalt noch Länge des Secrets. Der Stripe-Verifier prüft die
  Signatur über den Raw-Body.
- Bestätigungen sind idempotent (doppelter Webhook publiziert nicht erneut).
- `WEBHOOK_SECRET` muss in Produktion ein echter, nicht-Default-Wert sein.

## Missbrauchsschutz

- **Rate-Limiting** pro IP (`RATE_LIMIT_TTL_MS`, `RATE_LIMIT_MAX`) via
  `@nestjs/throttler`; `trust proxy` korrekt gesetzt für Cloud Run.
- **CORS-Allowlist** aus `CORS_ORIGINS` (kein Wildcard in Produktion).
- **In-App-Beweisaufnahme** nur über Capture-Intent-API (kein Galerie-Import).

## Secret-Management

Secrets (`DATABASE_URL`, `DIRECT_URL`, `WEBHOOK_SECRET`, Provider-Keys) gehören **nie**
ins Repository. Ablage:

- Lokal: untracked `platform/.env` (in `.gitignore`).
- Produktion: Secret Manager des Deploy-Hosts (z. B. Google Cloud Secret Manager),
  als Env-Vars injiziert. Siehe `docs/DEPLOY.md`.

## Dependency-Audit

`pnpm audit --prod` läuft in der CI (`.github/workflows/ci.yml`, Step „Security audit").
Transitive Lücken werden über `pnpm.overrides` in der Root-`package.json` auf gepatchte
Versionen gehoben:

| Paket | Angehoben auf | Behebt |
| --- | --- | --- |
| `next` | `14.2.35` | **Kritisch:** Authorization-Bypass in Middleware; diverse DoS/SSRF auf der 14.x-Linie |
| `multer` | `^2.2.0` | DoS (Resource Exhaustion, tiefe Feld-Verschachtelung) |
| `postcss` | `^8.5.22` | XSS via Unescaped `</style>` |
| `file-type` | `^21.3.2` | ZIP-Decompression-Bomb, Endlosschleife im ASF-Parser |
| `qs` | `^6.15.3` | Remote-DoS in `qs.stringify` |

### Bewusst getrackte Restrisiken (Major-Upgrade nötig)

- **Next.js ≥ 15:** Mehrere verbleibende Advisories (DoS/SSRF/Cache in Server
  Components, Server Actions, Middleware, `next/image`, Rewrites) sind erst ab Next 15
  behoben — ein Major-Upgrade, das React 19 voraussetzt. **Mitigierender Faktor:**
  `apps/web` und `apps/admin` sind reine Client-SPAs gegen die API; sie nutzen **keine**
  Server Actions, **keine** Middleware, **keine** Rewrites und keinen serverseitigen
  `next/image`-Optimizer. Die betroffene Angriffsfläche ist damit im aktuellen
  Deployment nicht exponiert. Upgrade auf Next 15 + React 19 ist als Folgeaufgabe
  eingeplant.
- **`@nestjs/core` ≥ 11.1.18:** Ein moderates Log-Neutralisierungs-Problem ist erst in
  NestJS 11 behoben (Major-Upgrade von 10). Eingeplant; Auswirkung auf Log-Ausgaben
  begrenzt.

Die CI schlägt bei **kritischen** Findings fehl (`--audit-level critical`), damit neue
kritische Lücken den Merge blockieren, ohne dass die getrackten Nicht-kritischen
Restrisiken die Pipeline dauerhaft rot färben.

## Meldung von Schwachstellen

Sicherheitsrelevante Funde bitte vertraulich an die Projektverantwortlichen melden,
nicht als öffentliches Issue.
