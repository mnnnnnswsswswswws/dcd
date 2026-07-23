# Static UI Audit (Mobile)

Konkrete Bestandsaufnahme: wo reagiert nichts, wo fehlen Zustände/Übergänge.
Bezug: `apps/mobile/app/*` und `components/*`.

## app/index.tsx — Challenge-Liste
- **Statische Präsentationsfolie:** vertikale Liste aus `Card`. Kein immersiver Feed, kein Wischen zwischen Challenges, kein Video/Bewegtvorschau.
- Preisgeld, Teilnehmerzahl, Countdown: **reine Textwerte, kein Aufbau/Count-up, kein Live-Update.**
- Karten reagieren nur mit Opacity/Scale beim Tap (ok), aber **kein „Öffnen"-Übergang** — der Detailscreen erscheint hart per Router-Push.
- Kein Speichern/Like direkt in der Karte. Keine Slots-fast-voll-/Beendet-/Gewinner-Zustände.
- Nur `FadeInUp` beim Mount — **identisches Fade auf allem** (Anti-Muster).

## app/challenge/[id].tsx — Detail
- **Erscheint abrupt** (kein geteilter Übergang aus der Karte).
- „Beitreten" / „Beweis einreichen": Buttons wechseln **hart** den Zustand (kein Transform, kein Zwischen-Loading am Button selbst; nur globales `busy`).
- Fortschrittsbalken (Slots) ist **statisch** — keine animierte Füllung, kein „fast voll"-Signal.
- Kriterien/Regeln: **statische Liste**, kein Bottom Sheet, nicht aufziehbar.
- Kein Erfolgs-/Fehler-Moment mit Bewegung — nur `note`/`error`-Text.

## components/EvidenceCamera.tsx — Aufnahme
- Aufnahme: **kein Countdown**, **kein pulsierender Aufnahmering**, kein Zeitindikator als Ring, keine Unterbrechungs-Warnung.
- Upload: **kein sichtbarer Fortschritt** (nur busy), keine Wiederaufnahme bei Fehler.
- Erfolg: einfacher Rücksprung, **kein hochwertiger Erfolgsmoment**.

## components/ui.tsx
- `Card`/`Button` haben Feder-Press (gut) — aber **kein einheitliches AnimatedPressable** mit Haptik; jede Stelle baut Press selbst.
- **Kein** AnimatedCounter, ProgressRing, RecordingPulse, UploadProgress, SuccessBurst, BottomSheet, HapticService.
- Badges/Status: **kein Zustandswechsel** (offen→fast voll→beendet→Gewinner).

## Fehlende Haptik (überall)
- Kein haptisches Feedback bei Auswahl, Teilnahme, Erfolg, Fehler.

## Fehlende Zustände (systemisch)
- `loading` nur als Text/Spinner statt Skeleton in Produktform.
- `success`/`error` ohne Bewegung; `empty`/`offline`/`partial` teils gar nicht.

## Fazit
Das Mobile-UI ist eine **Sammlung statischer Screens**. Es fehlt: immersiver Feed +
Wischen, animiertes Öffnen, Live-Zähler/Countdown, Regeln-Sheet, Aufnahme-/Upload-/
Erfolgs-/Fehler-Choreografie, gezielte Haptik, wiederverwendbare Motion-Bausteine.
→ Behoben im ersten interaktiven Flow (`app/play.tsx`, `components/motion/*`).
