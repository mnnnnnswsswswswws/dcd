# V2-Gap-Analyse — Stand nach Phase 0A

> Ehrliche Gegenüberstellung: Was das Repository heute enthält, was mit diesem Schritt
> dazugekommen ist und was aus dem V2-Auftrag **noch offen** ist. Keine Funktion wird
> als fertig geführt, nur weil ein Typ oder eine UI existiert (§30, Definition of Done).

## Mit diesem Schritt umgesetzt (Phase 0A, §43 Schritte 2–7, 12–13)

| Paket | Inhalt | Tests |
|---|---|---|
| `@vcp/compliance` | Legal Launch Gates (7 Status, 3 Stufen, fail-closed), 10 Pflichtgutachten, automatische Neubewertung bei wesentlicher Änderung, **Anti-Glücksspiel-Invarianten**, Stop-the-Line-Bedingungen | 36 |
| `@vcp/wellbeing` | Ausgabenlimits (Senkung sofort / Erhöhung 24 h), Schutzpausen inkl. Widerrufssperren, Interventionsstufen 0–4, Nutzungszeit, Ruhezeiten, Teilnehmerschutz | 30 |
| `@vcp/ai-governance` | Model-/Policy-Registry mit Deployment-Schwellen, Entscheidungsmatrix (Policy vor Modell), Reason Statements, Einspruchsverfahren | 27 |
| `@vcp/moderation` | Deterministische Policy Engine, 21 Policy-Codes, Risikoklassen, Kategorien mit Pflichtprüfung | 29 |

### Die tragenden Invarianten sind jetzt Code, nicht Prosa
- Teilnehmer zahlen nichts — jede Teilnehmergebühr > 0 ist eine Verletzung.
- Preisgeld stammt nie aus Teilnehmergeldern (kein Pooling).
- Gewinner werden nie zufällig bestimmt; nur `CREATOR_DECIDES`, `COMMUNITY_VOTE`, `AUTO_FALLBACK`.
- Gewinne können nicht erneut eingesetzt, gewettet oder in Coins getauscht werden.
- KI darf **niemals** final entscheiden über: Auszahlungssperre, Auszahlungsfreigabe,
  Gewinner, dauerhafte Kontosperre.
- `assertAntiGamblingInvariants` hat **keinen** Override-Parameter — die Prüfung ist
  nicht wegkonfigurierbar (§43, Architekturregel).

## Bereits vorher vorhanden (V1)
- Transaktionssichere Slot-Reservierung inkl. 50-Nutzer-Concurrency-Test (§26)
- Challenge-State-Machine, Funding über Webhook, Winner-Selection, Payout, Ledger
- Beweisaufnahme (In-App-Kamera, echtes `recordAsync`, Clip-Vorschau), Reports, Admin-Queue
- Mock-Provider für Payments; `REAL_MONEY_ENABLED=false` als Default

## Noch offen — ehrlich benannt

### Phase 0A/0B, unmittelbar anschließend
- [ ] **Prisma-Modelle** für die neuen Domänen: `legal_launch_gates`, `ai_assessments`,
      `ai_model_versions`, `policy_versions`, `automated_decisions`, `moderation_appeals`,
      `wellbeing_preferences`, `spending_limits`, `protection_pauses`,
      `safety_interventions`, `reason_statements` (§31, §37) — die Domänenlogik existiert,
      die Persistenz noch nicht.
- [ ] **Spending-Limit-Concurrency-Test** (§43 Schritt 10): Die Entscheidungsfunktion ist
      da und dokumentiert, dass sie in derselben Transaktion laufen muss — der Test, der
      parallele Zahlungen gegen das Limit fährt, fehlt noch.
- [ ] **Mock AI Safety Gateway** als Service (§43 Schritt 14); heute nur die Verträge.
- [ ] **Challenge Safety Copilot** im Wizard (§35.2, §43 Schritt 15) inkl. `safeRewrite`.
- [ ] **Red-Team-Testbibliothek** (§31 Schritt 20): gefährliche, manipulative,
      minderjährigenbezogene und glücksspielähnliche Challenges als Testkorpus.
- [ ] **Dark-Pattern-Tests** (§39) gegen die tatsächliche UI.
- [ ] Verdrahtung: API-Endpunkte `/ai/*`, `/users/me/wellbeing`, `/legal/*` (§38).

### Bewusste Grenzen der heutigen Policy Engine
Die deterministischen Regeln arbeiten mit Musterabgleich. Das erkennt das
Offensichtliche, nicht das Umschriebene. Deshalb gilt im Code und in den Tests:
ein Treffer kann **sperren oder eskalieren, nie freigeben**; kein Treffer heißt
ausdrücklich nicht „sicher". Die Freigabe entscheidet erst die Gesamtmatrix aus
Regeln, Modellen und — bei jedem Zweifel — einem Menschen. Die multimodale
Moderation (§35.4) und die Video Integrity Engine (§35.5) sind noch nicht gebaut.

### Nur durch den Betreiber lösbar (Konten/Verträge)
- Alle zehn Pflichtgutachten aus §33.3 (Kanzlei, DSB, Steuerberatung, Versicherung)
- Stripe-Live/KYC, Firebase-Projekt, S3/GCS-Bucket, Apple Developer
- Ohne `APPROVED_FOR_GERMANY_LIVE` bleiben Echtgeld, öffentliche Reichweite und
  Auszahlungen gesperrt — das erzwingt jetzt der Code, nicht nur das Dokument.

## Reihenfolge-Hinweis
§43 ist eindeutig: **erst die Invarianten, dann Feed und visuelles Polishing.** Der
zuvor geplante Apple/EAS-Build gehört damit hinter Phase 0B und die noch offenen
Schutztests — er ist nicht der nächste Schritt.
