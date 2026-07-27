# Übergabe an das lokale Claude Code / Cowork — WEITER HIER

> Diese Datei liegt im Repo, damit ein lokal laufendes Claude Code (oder Cowork) beim
> Öffnen des Ordners sofort weiß: **wo der Stand ist, was als Nächstes zu tun ist und
> welche Regeln gelten.** Lies sie zuerst.

## Wo du bist
- **Repo:** `mnnnnnswsswswswws/dcd`, App liegt unter **`platform/`** (pnpm-Monorepo).
- **Arbeitsbranch:** `claude/final-app-byiu6b`, aktueller Stand **Commit `b47c5d9`**.
- **Apps:** `apps/api` (NestJS + Prisma/Postgres), `apps/web` + `apps/admin` (Next.js),
  `apps/mobile` (Expo/React Native, SDK 57, expo-router).

## Was schon fertig & echt ist (nicht neu bauen)
- Vollständiger vertikaler Flow in der Mobile-App: Feed → Regeln → Teilnahme →
  Slot-Reservierung (mit Restzeit) → Kamera → Aufnahme → Upload → Einsendung, alles über
  einen zentralen Demo-Store (`apps/mobile/lib/demo/store.ts`).
- **Echte Kamera:** `expo-camera` `CameraView` live in Vorbereitung + Aufnahme; echter
  Mitschnitt via `recordAsync()`; Berechtigungen inkl. „verweigert"-Fehlerzustand.
- **Echte Clip-Vorschau:** `expo-video` spielt den aufgenommenen Clip in der preview-Phase
  (`apps/mobile/components/motion/ClipPreview.tsx`), mit sauberem Platzhalter-Fallback.
- **Profil:** neue Einsendungen erscheinen live unter „Meine Einsendungen" (`app/me.tsx`).
- Backend: Challenge-Lifecycle, Slot-Reservierung (transaktionssicher), Funding/Webhook,
  Winner-Selection, Payout — alles hinter Provider-Flags (mock als Default).

## Was NOCH offen ist (dein Auftrag) — Reihenfolge
Das Umschalten von „mock" auf echte Dienste passiert NUR über Environment-Variablen,
KEINE Code-Änderung nötig. Vollständige Variablenliste: **`platform/.env.example`**.

1. **DB (Neon):** `DATABASE_URL` (pooled) + `DIRECT_URL` (direct) in `platform/.env`,
   dann `pnpm exec prisma migrate deploy` + `pnpm exec prisma generate`.
2. **Auth (Firebase):** `AUTH_PROVIDER=firebase`, `FIREBASE_PROJECT_ID`,
   `GOOGLE_APPLICATION_CREDENTIALS` (Pfad zur JSON außerhalb des Repos).
3. **Storage (S3/R2):** `STORAGE_PROVIDER=s3` + Endpoint/Region/Bucket/Keys.
4. **Payments (Stripe, Test):** `PAYMENTS_PROVIDER=stripe`, `STRIPE_SECRET_KEY=sk_test_…`,
   `STRIPE_WEBHOOK_SECRET`, `WEBHOOK_SECRET` (echter Zufallswert). Echtgeld separat/später.
5. **Frontends:** `NEXT_PUBLIC_API_BASE`, `CORS_ORIGINS`, `pnpm -r build`.
6. **>>> APPLE / iOS-BUILD — HIER FORTSETZEN <<<** (siehe unten).

## >>> Nächster Schritt: Apple-Build (Phase 6) <<<
Ziel: die Mobile-App auf ein echtes iPhone / TestFlight bringen und dort verifizieren,
dass `recordAsync` + die `expo-video`-Vorschau real funktionieren.

Voraussetzungen (Konten): **Expo** (expo.dev) und **Apple Developer** (99 $/Jahr).

```bash
cd apps/mobile
npm install                      # eigene Toolchain (nicht pnpm)
npx eas login                    # mein Expo-Konto
# EXPO_PUBLIC_API_BASE = meine öffentliche API-URL (Build-Zeit) setzen
npx eas build -p ios             # Dev- oder Preview-Profil; Apple-Login, Bundle-ID/Signing
npx eas submit -p ios            # TestFlight
# Android optional: npx eas build -p android
```
Abnahme am Gerät: Play-Flow → Kamera nimmt via `recordAsync` auf → preview-Phase spielt
den Clip ab → Upload landet im S3-Bucket → Einsendung erscheint im Profil unter
„Meine Einsendungen" mit „● In-App-Clip" (statt „○ Beweis").

## Regeln (wichtig)
- **Keine Secrets committen.** Alles Geheime in `platform/.env` (via `.gitignore`
  ausgeschlossen) bzw. eine Service-Account-JSON AUSSERHALB des Repos. Vor jedem Commit
  `git status`/`git diff` prüfen.
- **Neon-Passwort rotieren**, falls noch nicht geschehen (war früher im Chat sichtbar).
- **Branch:** auf `claude/final-app-byiu6b` arbeiten. Wenn du pushen sollst, braucht dein
  Token `Contents: Read and write`.
- Fehlt ein Konto/Secret: **anhalten und gezielt nachfragen**, nicht raten, keine
  Platzhalter committen.

## Fortschritt zurückmelden (optional, empfohlen)
Wenn du pushen kannst: pflege eine Datei `platform/SETUP_STATUS.md` (nach jeder Phase
aktualisieren, committen, pushen). Format: Tabelle Phase/Status (⬜/🔄/✅/⛔) + je Phase
„Getan / Verifiziert durch / Env-Zustand (nur gesetzt ✓/✗, NIE Werte) / Blocker / Braucht
vom Nutzer / Frage an Claude". So kann das Cloud-Claude im Repo deinen Fortschritt lesen
und im Abschnitt „Antworten von Claude (Repo)" antworten.

## Referenzen im Repo
- `platform/.env.example` — alle Env-Variablen dokumentiert
- `platform/docs/DEPLOY.md` — Deployment/Migrationen
- `platform/docs/SECURITY.md` — Sicherheitshinweise
- `platform/packages/config/src/index.ts` — Env-Validierung + Flag-Guards
