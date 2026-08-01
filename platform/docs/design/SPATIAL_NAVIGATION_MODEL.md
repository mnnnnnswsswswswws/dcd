# Spatial Navigation Model

Eine klare räumliche Logik statt zufälliger Mischung aus Seiten/Modals/Popups.

## Ebenen (z-Achse)
```
z0  Feed            — die zentrale Ebene. Vertikal paged, immer der Heimatraum.
z1  Challenge-Detail — entsteht AUS der fokussierten Karte (expandiert in place,
                       kein neuer Screen-Push). Zurück = Karte schrumpft zurück.
z2  Regeln-Sheet    — kommt von UNTEN über die aktuelle Ebene (Bottom Sheet,
                       Rastpunkte). Verdeckt den Feed nicht ganz.
z2  Teilnehmer      — seitlich/gestapelt als Sheet, gleiche Ebene wie Regeln.
z3  Teilnahme-Overlay — legt sich über die Karte (räumlicher Eintritt: scale+fade),
                       gehört zur selben Challenge (kein Kontextverlust).
z4  Kamera          — bewusster Moduswechsel in einen immersiven Vollbild-Raum.
                       Eintritt/Austritt sind spürbar (nicht wie ein Tab-Wechsel).
```

## Prinzipien
1. **Alles Challenge-Bezogene entsteht aus der Challenge-Karte** und kehrt dorthin zurück — kein blindes Router-Push in einen fremden Screen.
2. **Von unten** = ergänzende Info/Kontrolle (Regeln, Teilnehmer) → Bottom Sheet.
3. **Darüber, aus der Karte** = Fortschritt derselben Handlung (Teilnahme→Aufnahme) → Overlay, das aus der Karte wächst.
4. **Vollbild-Moduswechsel** nur für die Kamera — der einzige Ort, der den Feed bewusst verlässt.
5. **Kein abrupter Rücksprung** nach dem Upload: die bestätigte Einsendung wird **in den Challenge-Status überführt** (die Karte, aus der man kam, zeigt jetzt „Eingereicht"). Man landet wieder auf z0, aber mit verändertem Zustand — Kontinuität statt Reset.
6. **Zurück** ist immer die Umkehr des Eintritts (Sheet nach unten, Overlay schrumpft, Detail kollabiert in die Karte) — nie ein Browser-artiger Sprung.

## Konsequenz für den Code
- Feed, Detail, Regeln, Teilnahme, Aufnahme leben in **einem** Screen (`app/play.tsx`) als Zustände einer Challenge, nicht als getrennte Routen.
- Die Kamera darf ein eigener immersiver Bereich sein, kehrt aber in denselben Challenge-Kontext zurück.
- Profil/Feed lesen denselben zentralen Store → der neue Zustand ist überall sofort sichtbar.
