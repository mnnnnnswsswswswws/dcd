---
name: microinteraction-designer
description: Definiert funktionale Mikrointeraktionen für Tippen, Halten, Wischen, Aufnehmen, Absenden, Gewinnen und Fehler. Nutze diese Skill, wenn Animationen/Feedback/Haptik entworfen werden. Jede Animation muss Orientierung, Rückmeldung oder Emotion leisten — dekorative Bewegung ist verboten.
---

# Microinteraction Designer

## Grundsatz
Jede Bewegung hat **eine** Aufgabe: räumliche Orientierung, Rückmeldung *oder* Emotion. Keine Deko.

## Pro Interaktion festlegen
| Feld | Inhalt |
| --- | --- |
| Auslöser | Tap / Long-Press / Swipe / Submit / Success / Error |
| Aufgabe | Orientierung / Rückmeldung / Emotion |
| Dauer | ms (Tap-Feedback 80–150, Übergang 200–350, Feier ≤600) |
| Kurve | benannter Ease (z. B. spring, ease-out) |
| Unterbrechbar | Ja/Nein — laufende Animation darf Eingabe nicht blockieren |
| Haptik | nur bei wichtigem Zustandswechsel (Erfolg/Fehler/Gewinn), sonst keine |
| Reduced Motion | Ersatzverhalten (Fade statt Bewegung, keine Endlos-Loops) |

## Regeln
- Sofortige sichtbare Reaktion auf jede Nutzeraktion (< 100 ms).
- Erfolg, Fehler, Laden, Abbruch haben je einen eigenen, erkennbaren Zustand.
- Feier-Momente (Gewinn/Teilnahme) sind selten und dadurch wertvoll — nicht auf jedem Tap.
- `prefers-reduced-motion` immer respektieren: Loops aus, Bewegung → Fade.
- Haptik gezielt: Selection-Tick bei Auswahl, Success bei Teilnahme/Gewinn, Warn bei Fehler.
