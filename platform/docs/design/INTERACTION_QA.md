# Interaction QA — Flow 1 (Feed → Teilnahme → Aufnahme → Upload → Einsendung)

## Getestete Aktionen (echt, im Web-Export der Expo-App gefahren)
1. **Live-Feed öffnen** — Home → „Live-Feed starten" → `app/play.tsx`.
2. **Vertikaler Feed** — `ScrollView pagingEnabled` mit Snap; Wechsel löst Selection-Haptik + Karten-Fokus (Scale) aus.
3. **Regeln-Bottom-Sheet** — öffnet von unten (Feder), Drag-Handle, per Backdrop-Tap/Drag-down schließbar; zeigt echte `description` + 3 Schritte.
4. **Speichern (Merken)** — Toggle mit Sofort-Reaktion (Stern füllt, Farbe) + Selection-Haptik.
5. **Mitmachen** — Button → `joining` (Spinner „Sichere deinen Platz…") → `joined` (SuccessBurst „Du bist drin. · Platz 5 von 10").
6. **Aufnahme** — „Jetzt aufnehmen" → `countdown` (3-2-1-Ring, Haptik-Tick je Sekunde) → `recording` (pulsierender Ring + laufender Timer + „Stoppen & einsenden").
7. **Upload** — echter Fortschrittsbalken; **provozierter Fehler bei 60 %** („Upload unterbrochen", roter Balken, Error-Haptik) → **„Nochmal versuchen"** → 100 % → Success-Haptik.
8. **Einsendung bestätigt** — SuccessBurst (expandierender Ring + Haken) „Eingereicht." + „Zum Feed".

## Getestete Gerätegrößen
- 390 × 844 (iPhone 14-Klasse) — Hauptdurchlauf, alle 8 Zustände als Screenshot festgehalten (`play-1…8`).
- (Feed zusätzlich auf 360 × 640 im Reveal-Flow geprüft.)

## Zustände pro Hauptkomponente — Abdeckung
- Challenge-Karte: default · pressed (Scale) · aktiv/inaktiv (Fokus-Scale) · gemerkt · Teilnahme läuft · fast-voll-Signal (`free ≤ 2` hebt „frei" hervor).
- Teilnahme: joining · joined · countdown · recording · uploading · error · done.
- Upload: uploading · error+Retry · done.
- Feed gesamt: loading (Skeleton) · empty (einladend) · Inhalt.

## Ergebnisse
| Bereich | Ergebnis |
| --- | --- |
| Flow ohne Erklärung verständlich | ✅ jede Stufe hat Titel + klare nächste Aktion |
| ≥ 5 echte Nutzeraktionen | ✅ 8 (Scroll, Merken, Regeln, Mitmachen, Aufnehmen, Stoppen, Retry, Weiter) |
| Jede Hauptaktion mit sichtbarem Feedback | ✅ Scale/Spinner/Burst/Progress |
| Kein Button ohne Press-State | ✅ alles über `AnimatedPressable` |
| Keine Ansicht ohne Übergang | ✅ Overlay skaliert/fadet ein, Sheet slidet, Karten federn |
| Lade-/Erfolg-/Fehlerzustand | ✅ Skeleton · SuccessBurst · Upload-Error+Retry |
| Gesten funktionieren | ✅ vertikales Paging, Sheet-Drag |
| Haptik gezielt | ✅ selection/medium/success/error an Zustandswechseln (nativ; Web No-op) |
| Reduced Motion | ✅ `prefersReducedMotion()` → Count-ups springen, Loops aus, Sheet fadet |
| Stabil bei schnellem Tippen | ✅ Timer/Upload räumen in Cleanup auf; Phasen idempotent |
| Animationen unterbrechbar | ✅ „Später" bricht ab, Retry ersetzt laufenden Upload |

## Probleme / überarbeitet
- **SPA-Routing im Export:** `/play` direkt liefert 404 (statischer Server); im Test client-seitig navigiert. In der echten App irrelevant (nativer Router). Nur Test-Setup.
- Konsolen-404 (Favicon/Route-Resource) — kein Page-Error, Flow unbeeinträchtigt.

## Noch statisch / offen
- `app/index.tsx` (Home-Liste), `challenge/[id].tsx`, `create`, `me`, `notifications`,
  `profile`: weiterhin überwiegend statisch → als Nächstes mit denselben Motion-Bausteinen beleben.
- `EvidenceCamera` nutzt noch nicht `RecordingPulse`/`UploadProgress` (echte Kamera) — angebunden werden, sobald der reale Aufnahme-Pfad drankommt.
- Shared-Element „Karte → Detail" ist als Overlay-Scale gelöst, noch kein echter geteilter Übergang.
