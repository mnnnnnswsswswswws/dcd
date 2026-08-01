# @vcp/mobile — Expo-App (Teilnehmer)

Native Mobile-App (Expo SDK 57, expo-router, React Native 0.86) für Teilnehmer und
Ersteller. Spricht dieselbe Plattform-API wie Web/Admin und bildet den vollständigen
Nutzer-Weg ab — inklusive der **In-App-Beweisaufnahme über die Gerätekamera**.

> Eigenständiges Projekt: bewusst **aus dem pnpm-Workspace ausgenommen** (`!apps/mobile`),
> damit die Expo-Toolchain ihre eigenen Abhängigkeiten/Lockfile verwaltet und der
> CI-Install/Build der Web-Pakete schlank bleibt. Eigener `package-lock.json` (npm).

## Funktionen

- Registrieren mit 18+-Gate (die zurückgegebene ID ist das Bearer-Token, Mock-Auth).
- Entdecken: offene Challenges (`GET /v1/challenges?status=OPEN`).
- Challenge-Detail: beitreten, Status/Plätze, Kriterien, Gewinner.
- **In-App-Beweisaufnahme** (`expo-camera`, Video, Kamera+Mikrofon) — **ohne** Galerie-/
  Dateizugriff. Hinter `LONG_CAPTURE_ENABLED`: `evidence-intent` → Aufnahme → Upload
  (bei echtem Storage) → Einreichen mit `evidenceRef`. Ohne Flag: Direkt-Submit (Stub).
- Community-Voting, Melden (`POST /v1/reports`).
- Ersteller-Selfservice: Einsendeschluss setzen, Gewinner festlegen/ermitteln, Abbrechen.
- Challenge erstellen (Titel/Beschreibung/Kategorie/Preisgeld/Modus/Frist).

## Konfiguration

Die API-Basis kommt aus `EXPO_PUBLIC_API_BASE` (Build-Zeit); ohne Vorgabe greift
`http://localhost:8080`. Auf dem Gerät ist ein Override in `AsyncStorage` vorgesehen
(SessionProvider). Für echte Geräte im WLAN die LAN-IP des API-Servers verwenden.

```sh
EXPO_PUBLIC_API_BASE="http://192.168.x.y:8080" npx expo start
```

## Entwickeln

```sh
cd platform/apps/mobile
npm install            # eigene Abhängigkeiten (nicht via pnpm-Workspace)
npm run typecheck      # tsc --noEmit
npx expo start         # Dev-Server (iOS/Android/Expo Go)
```

Native Builds laufen über EAS (`eas build`) außerhalb dieses Node-CI. Der Web-Export
(`npx expo export --platform web`) bündelt die App über Metro und dient hier als
Bundling-Verifikation.

## iOS-Build & TestFlight (EAS)

Der Build läuft in der Cloud über **EAS Build** (kein Mac nötig); der Upload zu
TestFlight über **EAS Submit**. Vorbereitet ist alles in `eas.json` und `app.json`
(Bundle-ID `de.vcp.mobile`, Version 1.0.0, Icon, Kamera-/Mikrofon-Nutzungstexte).

**Was NUR du persönlich tun kannst (Apple/Expo-Anmeldungen):**
1. **Apple Developer Program** ($99/Jahr) mit deiner Apple-ID abschließen und die
   Programm-/Steuer-Verträge in App Store Connect akzeptieren.
2. **Expo-Konto** anlegen und lokal einloggen: `npx eas-cli login`.
3. **App-Datensatz** in App Store Connect anlegen (Bundle-ID `de.vcp.mobile`) und die
   `ascAppId` + `appleTeamId` in `eas.json` eintragen.
4. **Signing:** beim `eas build` fragt EAS einmalig nach **Apple-ID-Login inkl. 2FA**,
   um Distributionszertifikat + Provisioning-Profil zu erzeugen — das passiert
   ausschließlich lokal bei dir (2FA gehört niemals in den Code/Chat). Alternativ einen
   **App Store Connect API-Key** (.p8) für 2FA-freie CI-Submits hinterlegen.
5. In TestFlight die **Beta-Tester** bzw. eine **öffentliche Gruppe** anlegen — daraus
   entsteht der Einladungslink/-code. (Apple stellt den Link, keine dritte Stelle.)

**Voraussetzung Backend:** TestFlight-Builds laufen über Mobilfunk/fremdes WLAN — die
API muss **öffentlich erreichbar** sein. Vor dem Build `EXPO_PUBLIC_API_BASE` in
`eas.json` auf die öffentliche API-URL setzen (siehe `docs/DEPLOY.md`); `localhost`/LAN
funktioniert auf dem Gerät nicht.

**Befehle (nach den Schritten oben):**
```sh
cd platform/apps/mobile
npx eas-cli login
npx eas-cli init                    # legt die EAS-Projekt-ID an
npx eas-cli build --platform ios --profile production
npx eas-cli submit --platform ios --profile production --latest
```

## Verifikationsstand

- `tsc --noEmit` grün.
- `npx expo export --platform web` grün (Metro bündelt die gesamte App, ~820 Module).
- Kamera-Aufnahme/native Laufzeit benötigt ein Gerät/Simulator (in dieser Umgebung
  nicht ausführbar) — der Code folgt der aktuellen `expo-camera`-API (SDK 57).
