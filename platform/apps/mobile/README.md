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

## Verifikationsstand

- `tsc --noEmit` grün.
- `npx expo export --platform web` grün (Metro bündelt die gesamte App, ~820 Module).
- Kamera-Aufnahme/native Laufzeit benötigt ein Gerät/Simulator (in dieser Umgebung
  nicht ausführbar) — der Code folgt der aktuellen `expo-camera`-API (SDK 57).
