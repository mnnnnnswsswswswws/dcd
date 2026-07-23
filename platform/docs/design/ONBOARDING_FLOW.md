# Onboarding — Flow & Entscheidungen

## 1. Warum das aktuelle Onboarding generisch wirkt (konkret)
Der bisherige Flow (`app/onboarding.tsx`, 3 Slides + Signup) verstößt gegen mehrere Regeln:

1. **Drei klassische Erklärfolien** — genau das verbotene Template-Muster.
2. **Emoji als „Kunst"** (🎬🎥🏆) = Platzhalter, kein echter Produktinhalt. Der Nutzer sieht *keine* echte Challenge, *kein* echtes Preisgeld, *keine* echten Menschen.
3. **Radial-Glow hinter dem Emoji** = zufälliger Verlauf / SaaS-Deko ohne Bedeutung.
4. **Identisches Layout** auf jeder Folie (Bild → Titel → Text → Punkte → Button) — Template-Rhythmus.
5. **Marketing-Microcopy** („Entdecke Challenges", „Gewinne echtes Preisgeld") — austauschbar, könnte jede App sein.
6. **Wert wird beschrieben, nicht erlebt.** Registrierung steht am Ende der Intro — *vor* jedem sichtbaren Produktwert.
7. **Keine Personalisierung, kein Einsatz-Gefühl** — nichts von „echte Menschen, echte Einsätze".

## 2. Drei Konzepte
**A — Cinematic & emotional („Der Reveal"):** Kalter Einstieg auf EINE echte, hochdotierte Challenge, inszeniert wie ein Trailer-Moment: Preisgeld zählt hoch, Restplätze/Countdown, gestapelte echte Teilnehmer. Wert wird *gefühlt* in Sekunde 1.

**B — Schnell & aktionsorientiert („Straight In"):** Direkt in den echten, wischbaren Feed (TikTok). Kein Intro. Erst beim „Teilnehmen" kommt just-in-time Interesse+Signup.

**C — Persönlich & spielerisch („Bau deine Arena"):** Start mit „Worauf hast du Bock?" → Interessen-Kacheln mit befriedigendem Auswahl-Feedback → sichtbarer Feed-Aufbau → personalisierter Feed (Duolingo).

## 3. Bewertung für die Challenge-App
- Das Produktmagische = **echte Einsätze + echte Menschen + unerwartete Chancen (Geld).** A liefert dieses Gefühl sofort. B ist am schnellsten, riskiert aber, dass die *Einsatz-/Gewinn-Bedeutung* ohne Rahmung untergeht. C gibt Handlungsmacht + Personalisierung, verzögert aber den emotionalen Haken.
- Keins allein erfüllt alle sechs Ziele (echte Challenge sehen → Einsatz verstehen → Prinzip am Fall begreifen → Interessen wählen → personalisierter Feed → Konto erst bei Teilnahme).

## 4. Gewählte Kombination (begründet)
**A eröffnet → C personalisiert → B liefert.**
1. **A (Reveal):** echte Challenge + Held-Zahl + Live-Beleg → Einsatz sofort spürbar (Ziele 1–3).
2. **C (Interessen):** eine mutige Auswahl-Frage baust sichtbar den Feed (Ziel 4–5).
3. **B (Feed):** Absprung in den echten, personalisierten Feed; **Konto erst bei „Teilnehmen"** (Ziel 6).

## 5. Screen-by-Screen (Ziel · Emotion · Aktion · Rückmeldung · Übergang · Microcopy)

### S1 — Reveal (echte Challenge) — **erster Abschnitt, jetzt als Prototyp**
- **Ziel:** in Sekunde 1 echten Wert + Einsatz zeigen.
- **Emotion:** „Krass, das ist echt und es geht um was."
- **Aktion (eine):** „Zeig mir mehr" (nächste echte Challenge im Reel). Sekundär, klein: „Ich hab schon ein Konto".
- **Rückmeldung:** Preisgeld zählt beim Erscheinen hoch; Avatare stapeln gestaffelt ein; Live-Punkt pulst.
- **Übergang:** horizontaler Reel-Wechsel (2–3 echte Challenges), dann „Weiter" → S2.
- **Microcopy:** Kicker „Gerade live". Unter Titel: „Film deinen besten Trick. Die Community kürt den Gewinner — das Preisgeld ist echt." Meta: „Noch {n} Plätze · endet in {d} Tagen". CTA: „Nächste ansehen" / letzte Karte „Worauf hast du Bock? →".

### S2 — Interessen (Arena bauen)
- **Ziel:** Personalisierung + Commitment vor Konto.
- **Emotion:** „Das wird meins."
- **Aktion:** 3–8 Kacheln antippen (Sport, Kochen, Mut, Kreatives, Gaming, Fitness, Musik, Money). Primär „Feed bauen" (aktiv ab 1 Auswahl).
- **Rückmeldung:** Kachel füllt sich mit Identitätsfarbe + Häkchen, Selection-Tick (Haptik), Zähler „{k} gewählt".
- **Übergang:** „Feed bauen" → kurzer Aufbau-Moment (S3-Micro) → Feed.
- **Microcopy:** „Worauf hast du Bock?" · „Tipp an, was dich reizt — wir bauen deinen Feed."

### S3 — Feed-Aufbau (Micro-Moment, ≤ 1.2 s)
- **Ziel:** spürbare Personalisierung, kein leeres Warten.
- **Rückmeldung:** „Wir mischen deine Challenges…" mit den gewählten Interessen als durchlaufende Chips; endet mit sanftem Einlauf des Feeds.
- **Reduced Motion:** direkter Fade, kein Loop.

### S4 — Personalisierter Feed (Produkt)
- **Ziel:** Nutzung ohne Konto. Der eigentliche Wert.
- **Aktion:** browsen, liken, Detail öffnen — alles ohne Anmeldung.
- **Konto-Gate:** erst bei **Teilnehmen / Kommentieren / Auszahlung** → dann das Ein-Schritt-Sheet (18+ + Name), im Kontext der Handlung erklärt.

### Zustände (alle Screens)
- **Laden:** Skeleton in Produktform (nicht Spinner).
- **Leer (keine offenen Challenges):** ehrlicher, einladender Empty-State mit „Erste Challenge erstellen", kein toter Screen.
- **Fehler (API):** ruhige Zeile + „Nochmal", nie Sackgasse.
- **Abbruch:** „Überspringen" führt in den (unpersonalisierten) Feed, nie zurück ins Nichts.

## 6. Motion / Gesten / Haptik (Auszug, Details in microinteraction-designer)
- Preisgeld-Count-up: 900 ms, ease-out, Haptik-Success am Ende (nativ). Reduced Motion: Zielwert sofort.
- Avatare: stagger 60 ms, spring. Reduced Motion: gemeinsam einblenden.
- Reel-Wechsel: 280 ms ease. Interessen-Tap: 120 ms spring + Selection-Tick.
- Kein Dauer-Loop außer dem dezenten Live-Puls (Funktion: „läuft jetzt").

## 7. Umsetzungsstand & Visual-QA (Abschnitt 1 „Reveal")
Implementiert: `app/onboarding.tsx` (RevealCard, Count-up, echte Daten aus `/v1/challenges`),
Styles `.rv-*` in `globals.css`. Gerendert auf 390×844 und 360×640.

**QA-Runde 1 → Fixes:**
| Fund | Schwere | Fix |
| --- | --- | --- |
| Preis-Label „ZU GEWINNEN" bricht neben der Zahl um, schwache Hierarchie | mittel | Label als Eyebrow ÜBER die Held-Zahl gestellt, Kontrast `--faint`→`--muted` |
| Ersteller zeigte „@creator" (username null) — wirkt wie Platzhalter | hoch | echte Handles gesetzt (@lena_skates, @max_air, @ayla_cooks) |
| 0-Teilnehmer-Fall unklar | mittel | ehrlicher Zustand „Sei die oder der Erste · N frei" statt Fake-Avatare |

**QA-Runde 2 → Urteil:** besteht. Echter Produktinhalt, ein Fokus (Preisgeld-Held-Zahl),
eine Hauptaktion, echter Live-Beleg, unterschiedliche Zustände (Crowd vs. leer),
wiederverwendbare Karte mit je anderem echten Inhalt (kein Template-Rhythmus).
Auf beiden Gerätegrößen ausbalanciert.

## 8. Als Nächstes (nach bestandener QA)
S2 Interessen-Auswahl → S3 Feed-Aufbau-Moment → S4 personalisierter Feed;
Konto-Gate als kontextuelles Ein-Schritt-Sheet bei Teilnahme/Kommentar/Auszahlung.
Danach Portierung des Reveal + Flow auf Mobile (Expo).
