# Motion System (Mobile)

Verbindliches Bewegungssystem. Umgesetzt über RN `Animated` (nativer Treiber) +
`PanResponder` (eingebaut) und `expo-haptics`. Tokens: `lib/motion.ts`. Haptik:
`lib/haptics.ts`. Bausteine: `components/motion/*`.

**Regel:** Keine Bewegung ist reine Deko. Jede erfüllt ≥1 Zweck: Orientierung,
Feedback, Statusanzeige, Fokus, Belohnung, räumlicher Zusammenhang, Fehlererkennung,
emotionale Wirkung.

## Motion-Tokens (lib/motion.ts)
| Token | Wert | Einsatz |
| --- | --- | --- |
| `dur.tap` | 110 ms | Berührungs-Feedback |
| `dur.move` | 260 ms | Übergänge, Öffnen, Sheet |
| `dur.celebrate` | 560 ms | Erfolg/Gewinn (selten) |
| `spring.press` | speed 40, bounce 12 | Press-Scale |
| `spring.enter` | speed 12, bounce 9 | Eintritt mit Charakter |
| `ease.out` | Easing.out(cubic) | Werte-Aufbau, Fortschritt |
| `ease.inout` | Easing.inOut(sin) | Loops (Puls) |
| `scale.press` | 0.96 | gedrückte Fläche |

## Bewegungsarten (Auslöser · Start→Ende · Dauer · Easing · unterbrechbar · Geste · Haptik · Zweck)
| Bewegung | Spec |
| --- | --- |
| **Screen-Übergang** | Route-Wechsel · fade+8px→0 · move · ease.out · ja · — · — · Orientierung |
| **Karten-Eintritt** | Mount/Scroll-in · y16+scale.97→1 · enter(spring) · ja · — · — · räuml. Zusammenhang |
| **Karten-Austritt** | Scroll-out · aktive Karte skaliert 1→0.94, dimmt · move · ease.out · ja · vertikaler Swipe · — · Fokus |
| **Feed-Scroll** | Vertikaler Swipe · paging + snap · nativ · ja · Swipe up/down · leichter Tick beim Snap · Orientierung |
| **Button-Press** | PressIn/Out · scale 1→0.96→1 · tap · spring.press · ja · — · selectionAsync · Feedback |
| **Long-Press** | ≥350 ms · Karte hebt (scale 1.02) + Vorschau · move · ease.out · ja · Halten · impact(light) · Fokus/Vorschau |
| **Modal/Sheet öffnen** | Tap „Regeln" · translateY 100%→0 + Backdrop 0→0.5 · move · ease.out · ja · Drag-down zum Schließen · impact(light) · räuml. Zusammenhang |
| **Bottom-Sheet-Drag** | Drag · folgt Finger 1:1; >30% oder Flick → schließen, sonst zurück-Spring · tap/move · spring · ja · Pan · — · Kontrolle |
| **Ladeanimation** | Fetch · Skeleton-Shimmer in Produktform · loop · ease.inout · ja · — · — · Statusanzeige (kein Spinner) |
| **Countdown (Aufnahme)** | Teilnahme→Aufnahme · Ring füllt + Zahl 3→2→1 · 1s/Schritt · ease.out · abbrechbar · — · impact je Sekunde · Statusanzeige |
| **Aufnahme-Puls** | Recording · Ring pulsiert 1↔1.15, Timer läuft · loop 1.1s · ease.inout · ja (Stop) · Tap Stop · impact(medium) bei Start/Stop · Statusanzeige |
| **Upload-Fortschritt** | Nach Stop · Balken 0→100%, nicht blockierend · realer Progress · ja (Abbruch/Retry) · — · notify(success) bei 100% · Statusanzeige/Fehlererkennung |
| **Erfolgszustand** | Upload 100% · SuccessBurst (Ring+Haken skaliert), Text/Status wechselt · celebrate · spring · ja · — · notify(success) · Belohnung |
| **Fehlerzustand** | Fehler · kurzes Shake (x ±6px), roter Rand, „Nochmal" · tap·2 · ease.out · ja · — · notify(error) · Fehlererkennung |
| **Fortschritt (Slots)** | Datenänderung · Balken/Ring animiert auf neuen Wert; „fast voll" pulst 1× · move · ease.out · ja · — · — · Statusanzeige |
| **Gewinnerzustand** | Gewinner steht fest · stärkerer, aber nicht kindlicher Reveal (Zahl+Glanz-Sweep 1×) · celebrate · ease.out · ja · — · notify(success) · Belohnung/Emotion |
| **Teilnehmerzähler** | Live/Join · AnimatedCounter zählt hoch · move · ease.out · ja · — · — · Feedback/Statusanzeige |

## Reduced Motion
`AccessibilityInfo.isReduceMotionEnabled()` + `prefers-reduced-motion` (Web):
- Loops aus (Puls → statischer Zustand), Count-ups springen auf Zielwert,
  Sheet/Öffnen → schneller Fade statt Translate, keine Feier-Bursts (nur Statuswechsel).

## Haptik-Politik (lib/haptics.ts)
Gezielt, nie flächig: `selection` bei Auswahl/Tap wichtiger Aktionen · `impact(light)`
bei Öffnen/Long-Press · `impact(medium)` bei Aufnahme Start/Stop · `notify(success)`
bei Einsendung/Gewinn · `notify(error)` bei Fehler. Web/Server: No-op.
