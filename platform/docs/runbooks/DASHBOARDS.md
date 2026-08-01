# Dashboards und Schwellenwerte (Scale S1, Aufgabe 15)

> Datenquelle ist `apps/api/src/observability/metrics.ts` — ausführbarer, getesteter
> Code statt einer handgeschriebenen Definition, die lautlos veraltet. Jede Kennzahl
> unten wird von `collectMetrics()` tatsächlich erhoben; die Integrationstests in
> `test/metrics.integration.test.ts` erzwingen die Verstöße, die hier alarmieren.

## Warum diese sechs Bereiche

Die Reihenfolge ist keine Geschmacksfrage: **Business Integrity steht über allem.**
Ein langsamer Feed ist ärgerlich, eine doppelte Auszahlung ist ein Geschäftsvorfall.
Wenn zwei Dashboards gleichzeitig rot sind, wird zuerst der untere Block bearbeitet.

---

## 1 · Cache

| Kennzahl | Quelle | Grün | Gelb | Rot |
|---|---|---|---|---|
| Hit-Rate | `CacheMetrics.onHit/onMiss` | > 85 % | 60–85 % | < 60 % |
| Store-Fehler pro Minute | `onStoreError` | 0 | 1–10 | > 10 |
| Singleflight-Joins | `onSingleflightJoin` | beliebig | — | — |

**Deutung:** Store-Fehler > 0 heißt Redis-Probleme, **nicht** Datenverlust — der Cache
degradiert bewusst zu Direktabfragen (`packages/cache/src/cache.ts`). Rot bedeutet
also erhöhte DB-Last, nicht Fehlfunktion. Viele Singleflight-Joins sind ein *gutes*
Zeichen: Sie zeigen abgefangene Stampedes.

**Reaktion bei Rot:** Redis-Verfügbarkeit prüfen. DB-Auslastung (Block 4) im Blick
behalten — dort schlägt der Ausfall durch.

---

## 2 · Queue (asynchrone Operationen)

| Kennzahl | Feld | Grün | Rot |
|---|---|---|---|
| Ausstehend | `queue.asyncOperationsPending` | < 100 | > 1000 |
| Hängend | `queue.stuckRunning` | 0 | ≥ 1 |
| Gescheitert | `queue.asyncOperationsFailed` | < 1 % der Gesamtzahl | > 5 % |

**Deutung:** `stuckRunning` zählt Operationen, die länger als 15 Minuten auf `RUNNING`
stehen. Da terminale Zustände endgültig sind, kann das nur ein abgestürzter Worker
sein — die Operation wird nie von selbst fertig.

**Reaktion:** Worker-Logs prüfen, Operation über den zuständigen Task erneut anstoßen.

---

## 3 · Outbox Lag

| Kennzahl | Feld | Grün | Gelb | Rot |
|---|---|---|---|---|
| Ausstehend | `outbox.pending` | < 500 | 500–5000 | > 5000 |
| Alter des ältesten | `outbox.oldestPendingAgeMs` | < 5 s | 5–30 s | > 30 s |
| Endgültig gescheitert | `outbox.exhausted` | **0** | — | ≥ 1 |
| Projektions-Rückstand | `projection.lagEvents` | < 100 | 100–1000 | > 1000 |

**Deutung:** `exhausted ≥ 1` ist immer rot — ein Event hat seine Versuche aufgebraucht
und steht auf `FAILED`. Es wird **nicht** automatisch erneut zugestellt und braucht
menschliche Sichtung. Der Worker loggt das mit `AUFGEGEBEN seq=…`.

**Reaktion:** `SELECT * FROM outbox_events WHERE status = 'FAILED'` — `last_error`
lesen, Ursache beheben, dann gezielt auf `PENDING` zurücksetzen.

---

## 4 · DB Connections

| Kennzahl | Feld | Grün | Gelb | Rot |
|---|---|---|---|---|
| Auslastung | `db.utilizationPercent` | < 60 % | 60–80 % | > 80 % |

**Deutung:** Das Budget ist in `packages/capacity` festgelegt und im CI geprüft
(aktuell 146 von 180 möglichen Verbindungen im Worst Case). Übersteigt die reale
Auslastung dauerhaft die Rechnung, stimmt eine Annahme nicht — meist `DB_POOL_SIZE`,
das in der Umgebung nicht ankommt.

**Reaktion:** Nicht die `max_instances` erhöhen. Erst prüfen, ob `DB_POOL_SIZE` in
allen Diensten wirkt (`connection_limit` in der Datasource-URL), dann die Datenbank
skalieren und das Budget in `packages/capacity` nachziehen — der CI-Test erzwingt
Konsistenz mit Terraform.

---

## 5 · Replica Lag

| Kennzahl | Feld | Grün | Rot |
|---|---|---|---|
| Verzögerung | `replica.lagMs` | < 1000 ms | > 5000 ms |

**Deutung:** `null` bedeutet „keine Replik angebunden", nicht „kein Rückstand" — die
Metrik rät bewusst nicht. Solange keine Read Replica existiert, ist dieser Block leer.

**Wichtig:** Auch bei grünem Lag darf keine kritische Entscheidung von einer Replik
gelesen werden (Architekturregel 2). Slot-Vergabe, Votes, Gewinner und Geld lesen
ausschließlich primär.

---

## 6 · Business Integrity — der wichtigste Block

| Kennzahl | Feld | Erwartung |
|---|---|---|
| Überbelegte Challenges | `businessIntegrity.challengesOverCapacity` | **immer 0** |
| Doppelte Gewinnerentscheidungen | `duplicateWinnerDecisions` | **immer 0** |
| Doppelte Auszahlungen | `duplicatePayouts` | **immer 0** |
| Unausgeglichene Ledger-Gruppen | `unbalancedLedgerGroups` | **immer 0** |

Jeder Wert ≠ 0 ist ein **Stop-the-Line-Ereignis** (§40): Rollout anhalten, nicht erst
die Ursache suchen. Diese Zustände sind laut Produktregeln unmöglich; ein Treffer
bedeutet, dass eine Sperre versagt hat.

**Reaktion:**
1. Rollout stoppen, betroffene Challenge-IDs sichern.
2. Bei doppelter Auszahlung: `PAYOUTS_ENABLED=false` setzen, bevor weiter analysiert wird.
3. Audit-Log und Ledger für die betroffene Challenge auswerten.
4. Erst nach verstandener Ursache fortsetzen.

---

## Erhebung

`collectMetrics(prisma)` liefert alle sechs Bereiche in einem Aufruf. Vorgesehen als
periodischer Worker-Lauf, der die Werte an Cloud Monitoring meldet.

**Ehrlicher Stand:** Die Erhebung ist implementiert und getestet; der Export nach
Cloud Monitoring ist es **nicht** — dafür fehlen Projekt und Credentials. Bis dahin
ist `collectMetrics` manuell oder über einen eigenen Endpunkt abrufbar.
