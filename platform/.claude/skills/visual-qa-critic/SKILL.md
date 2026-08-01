---
name: visual-qa-critic
description: Rendert implementierte Screens in realistischen Gerätegrößen und prüft sie wie ein strenger Design Director. Nutze diese Skill nach jeder größeren UI-Umsetzung. Markiert generische/unausgewogene/inkonsistente Bereiche; nichts gilt als fertig, solange es wie ein Template wirkt.
---

# Visual QA Critic

## Ablauf
1. Screen in echter Gerätegröße rendern (Playwright, iPhone-Viewport 390×844 und klein 360×640).
2. Screenshot ansehen — nicht den Code, das Bild.
3. Gegen die Checkliste prüfen. Jeder Fund = konkreter, umsetzbarer Fix.

## Checkliste
- **Template-Test:** Könnte dieser Screen in jeder x-beliebigen App stehen? Wenn ja → durchfallen.
- **Visueller Mittelpunkt:** Genau ein klarer Fokus? Oder alles gleich laut?
- **Eine Hauptaktion:** Ist die primäre Aktion sofort erkennbar und dominant?
- **Hierarchie:** Größen, Gewicht, Kontrast führen den Blick in sinnvoller Reihenfolge?
- **Rhythmus:** Abstände aus der Skala? Nichts „zufällig" gesetzt?
- **Echter Inhalt:** Produktdaten statt Platzhalter/Lorem?
- **Microcopy:** Kurz, natürlich, mit Persönlichkeit — kein Marketing-Sprech?
- **Zustände:** Laden, leer, Fehler, Erfolg, Abbruch vorhanden und unterschiedlich?
- **Accessibility:** Kontrast ≥ 4.5:1 (Text), Touch-Ziele ≥ 44 px, Fokus sichtbar, Safe Areas beachtet, Tastatur nutzbar?
- **Konsistenz:** Komponenten wiederverwendet — aber sieht nicht jeder Screen gleich aus?

## Urteil
Ergebnis als Liste `Screen · Fund · Schweregrad · Fix`. Kein „fertig", solange ein Template-Muster oder ein generischer Text erkennbar ist. Nach Fixes erneut rendern und prüfen.
