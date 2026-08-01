# Deployment auf Google Cloud Run

Dieses Runbook beschreibt den Weg von einem leeren Google-Cloud-Projekt zu einer
laufenden Plattform. Es ist so geschrieben, dass jeder Schritt entweder erkennbar
gelingt oder mit einer verständlichen Meldung abbricht — nicht so, dass er
„irgendwie durchläuft".

**Was hier bewusst nicht steht:** echte Schlüssel, Passwörter oder Verbindungs-URLs.
Die stehen ausschließlich im Secret Manager. Terraform legt die Secret-Container an
und vergibt den Lesezugriff, kennt die Werte aber nie — ein Secret im Terraform-Code
landet im State, und der State ist eine Datei, die kopiert und gesichert wird.

---

## 0. Voraussetzungen

| Was | Warum |
| --- | --- |
| Google-Cloud-Projekt mit **aktivem Abrechnungskonto** | Ohne Abrechnung lehnt Cloud Run das Anlegen jedes Dienstes ab. |
| `gcloud` CLI, angemeldet (`gcloud auth login` + `gcloud auth application-default login`) | Terraform nutzt die Application-Default-Credentials. |
| Terraform ≥ 1.5 | Für `precondition` in `lifecycle`-Blöcken. |
| Rolle `roles/owner` oder gleichwertig für den ersten Lauf | Es werden APIs aktiviert, Dienstkonten angelegt und IAM vergeben. |

```sh
gcloud config set project DEIN_PROJEKT
gcloud auth application-default login
```

---

## 1. Was Terraform anlegt

| Bereich | Ressourcen |
| --- | --- |
| Rechenzeit | Cloud-Run-**Services** `api`, `web`, `admin`; Cloud-Run-**Jobs** `worker-outbox`, `worker-sweeps`, `worker-projection`, `migrate` |
| Zeitsteuerung | Cloud-Scheduler-Jobs, die die Worker-Jobs starten |
| Daten | Cloud SQL (PostgreSQL 16, privat, HA), Memorystore Redis 7 |
| Netz | Private Service Connection, VPC-Access-Connector |
| Broker | Pub/Sub-Topic `challenge-events`, Abonnement `challenge-projection`, Dead-Letter-Topic + Abonnement |
| Identität | Ein Dienstkonto je Dienst, Rechte aus der Kapazitätstabelle abgeleitet |
| Secrets | Container für `database-url`, `direct-url`, `webhook-secret` (ohne Werte) |
| Images | Artifact-Registry-Repository `vcp` mit unveränderlichen Tags |

### Warum die Worker Jobs sind und keine Services

Die Worker in `apps/workers/src/*.ts` sind Polling-Prozesse **ohne HTTP-Listener**.
Cloud Run erwartet von einem Service, dass er innerhalb der Startfrist auf `$PORT`
hört; ein Worker als Service scheitert deshalb zuverlässig am Startup-Probe, ohne
dass die Ursache im Log steht. Als Job mit `--once` und Scheduler-Trigger läuft
derselbe Code unverändert — mit sichtbarem Erfolgs- oder Fehlerstatus je Lauf.

---

## 2. Erster Durchlauf

Der erste Deploy ist **zweistufig**. Der Grund: `NEXT_PUBLIC_API_BASE` wird zur
Build-Zeit in das Frontend-Bundle eingebettet (siehe `apps/web/lib/api.ts`) und lässt
sich nicht als Laufzeit-Umgebungsvariable nachreichen. Vor dem ersten `apply` ist die
API-URL aber noch nicht bekannt.

### 2.1 Infrastruktur anlegen

```sh
cd platform/infrastructure/terraform
terraform init
terraform plan  -var project_id=DEIN_PROJEKT
terraform apply -var project_id=DEIN_PROJEKT
```

Der Lauf bricht bewusst ab, wenn das Verbindungsbudget verletzt ist:

```
DB-Verbindungsbudget überschritten: 246 benötigt, 180 verfügbar.
```

Das ist kein Terraform-Fehler, sondern der Kapazitäts-Guard (`packages/capacity`).
Er ist zu beheben, indem `max_instances` sinkt, `db_pool_size` kleiner wird oder die
Datenbank wächst — **nicht**, indem die Vorbedingung entfernt wird.

Die Cloud-Run-Dienste starten in diesem Lauf noch nicht erfolgreich: Es gibt weder
ein Image noch Secret-Werte. Das ist erwartet.

### 2.2 Secret-Werte setzen

Die Verbindungs-URLs bestehen aus dem Cloud-SQL-Verbindungsnamen und dem Passwort,
das du für den Datenbanknutzer vergibst.

```sh
CONN=$(terraform output -raw sql_connection_name)

# Datenbanknutzer anlegen (Passwort NICHT in der Shell-History lassen —
# `read -s` schreibt es nicht mit).
read -rs -p "DB-Passwort: " DBPW; echo
gcloud sql users create vcp --instance=vcp-postgres --password="$DBPW"

# Laufzeit: über den Auth-Proxy-Socket, mit Poolgrenze aus DB_POOL_SIZE.
printf '%s' "postgresql://vcp:${DBPW}@localhost/vcp?host=/cloudsql/${CONN}" \
  | gcloud secrets versions add database-url --data-file=-

# Migrationen: dieselbe Verbindung, aber ungepoolt.
printf '%s' "postgresql://vcp:${DBPW}@localhost/vcp?host=/cloudsql/${CONN}" \
  | gcloud secrets versions add direct-url --data-file=-

# Webhook-Signaturen. Ein Default-Wert ist in Produktion verboten —
# packages/config lehnt ihn beim Start ab.
openssl rand -hex 32 | gcloud secrets versions add webhook-secret --data-file=-

unset DBPW
```

> Bei einem verwalteten Postgres wie Neon statt Cloud SQL: `database-url` ist die
> **gepoolte** (`-pooler`) URL, `direct-url` die ungepoolte. Die Aufteilung ist
> dieselbe, nur die Hosts unterscheiden sich.

### 2.3 Image bauen

```sh
REPO=$(terraform output -raw image_repository)
API_URL=$(terraform output -json service_urls | jq -r .api)

gcloud builds submit \
  --substitutions=_API_BASE="$API_URL" \
  --tag "$REPO/api:$(git rev-parse --short HEAD)" \
  --build-arg NEXT_PUBLIC_API_BASE="$API_URL" \
  ../..
```

Ein Image bedient alle Prozesse; unterschieden wird über `args`. Das hält den
Rollout atomar — API, Frontends und Worker laufen garantiert auf demselben Stand
statt in einer halb migrierten Mischung.

### 2.4 Migration ausführen

**Vor** dem Rollout, und bewusst als eigener Schritt. Eine Migration als Nebeneffekt
eines Deployments ist die Art Automatik, die man genau einmal bereut.

```sh
gcloud run jobs execute migrate --region=europe-west3 --wait
```

### 2.5 Image-Tags festschreiben und erneut anwenden

```sh
TAG=$(git rev-parse --short HEAD)
terraform apply -var project_id=DEIN_PROJEKT \
  -var "image_tags={\"api\":\"$REPO/api:$TAG\",\"web\":\"$REPO/api:$TAG\",\"admin\":\"$REPO/api:$TAG\"}"
```

`:latest` funktioniert, ist für Produktion aber die falsche Wahl: Ein Rollback zeigt
sonst auf ein anderes Image als der ursprüngliche Rollout. Für Produktion gehört
hier ein Digest (`@sha256:…`) statt eines Tags.

---

## 3. Nachprüfen, dass es wirklich läuft

Ein grüner `apply` heißt nur, dass die Ressourcen existieren. Diese fünf Prüfungen
zeigen, dass die Kette trägt:

```sh
# 1. API erreichbar und mit Datenbankverbindung
curl -fsS "$(terraform output -json service_urls | jq -r .api)/health"

# 2. Poolgröße kommt tatsächlich in der Anwendung an
gcloud run services describe api --region=europe-west3 \
  --format='value(spec.template.spec.containers[0].env)' | grep DB_POOL_SIZE

# 3. Worker-Job läuft durch
gcloud run jobs execute worker-outbox --region=europe-west3 --wait

# 4. Ereignisse erreichen das Topic
gcloud pubsub topics list-subscriptions challenge-events

# 5. Read Model zieht nach — Rückstand muss gegen 0 gehen
gcloud logging read \
  'resource.labels.job_name="worker-projection" AND textPayload:"verarbeitet"' \
  --limit=5 --freshness=10m

# 6. Beweisprüfung laeuft — sonst bleibt jede 202-Antwort fuer immer PENDING
gcloud logging read \
  'resource.labels.job_name="worker-sweeps" AND textPayload:"beweise_geprueft"' \
  --limit=5 --freshness=10m
```

Kommt bei (2) nichts zurück, läuft der Dienst mit der Fallback-Poolgröße aus
`apps/api/src/prisma/pool-url.ts` (5) statt mit der budgetierten — dann stimmt die
Rechnung in `packages/capacity` nicht mehr mit der Wirklichkeit überein.

---

## 4. Wiederkehrende Deployments

```sh
TAG=$(git rev-parse --short HEAD)
gcloud builds submit --tag "$REPO/api:$TAG" --build-arg NEXT_PUBLIC_API_BASE="$API_URL" ../..
gcloud run jobs execute migrate --region=europe-west3 --wait
terraform apply -var project_id=DEIN_PROJEKT -var "image_tags={...:\"$REPO/api:$TAG\"}"
```

Reihenfolge ist nicht beliebig: erst Migration, dann Rollout. Eine neue Anwendung
gegen ein altes Schema scheitert lauter als ein altes Anwendungsexemplar gegen ein
neues Schema — solange die Migration additiv ist. Entfernende Migrationen (Spalte
löschen, Constraint verschärfen) gehören in zwei getrennte Deployments.

---

## 5. Was dieses Runbook **nicht** leistet

Ehrlich benannt, damit niemand es für erledigt hält:

- **Kein `terraform plan` gegen ein echtes Projekt gelaufen.** Die Konfiguration ist
  mit `terraform validate` gegen das Provider-Schema geprüft (auch in CI), aber
  Fehler, die erst gegen die echte API auftreten — Kontingente, Namenskonflikte,
  Regionsverfügbarkeit —, treten beim ersten `plan` auf.
- **Pub/Sub ist nie gegen ein Topic in der echten Cloud gelaufen** — wohl aber gegen
  den offiziellen Emulator mit dem echten Client (siehe Abschnitt 6). Was der
  Emulator nicht abbildet: Kontingente, IAM, regionsübergreifende Zustellung und
  die tatsächliche Durchsetzung der Ordering-Regeln.
- **Kein Custom Domain, kein Load Balancer, kein CDN.** Cloud Run liefert
  `*.run.app`-URLs. Für den öffentlichen Betrieb fehlen Domain-Mapping und
  Cache-Header vor dem Feed.
- **Metriken werden nicht nach Cloud Monitoring exportiert.**
  `apps/api/src/observability/metrics.ts` erhebt sie, aber nichts schreibt sie
  fort. Die Dashboards in `DASHBOARDS.md` beschreiben, was zu bauen ist.
- **Lasttests liefen gegen lokales PostgreSQL,** nicht gegen die Zielinfrastruktur.
  Die Kapazitätszahlen sind hergeleitet, nicht gemessen.
- **Kein Echtgeld.** `REAL_MONEY_ENABLED` bleibt aus. Die Anwendung startet mit
  `true` ohne echten Zahlungsanbieter absichtlich nicht.

---

## 6. Pub/Sub lokal prüfen (ohne Cloud-Zugang)

Die Ereigniskette lässt sich vollständig gegen einen **echten** Pub/Sub-Client
durchspielen — der offizielle Emulator braucht weder Projekt noch Credentials.

```sh
gcloud components install pubsub-emulator --quiet
gcloud beta emulators pubsub start --project=vcp-test --host-port=127.0.0.1:8685 --quiet

# in einer zweiten Shell
export PUBSUB_EMULATOR_HOST=127.0.0.1:8685
pnpm --filter @vcp/outbox test
```

Ohne gesetzte `PUBSUB_EMULATOR_HOST` überspringen sich die Broker-Tests sauber; CI
bleibt dadurch grün, ohne Java zu installieren.

### Was dieser Weg gefunden hat

Beide Punkte hätten Doubles nicht zeigen können — sie bestätigen nur, dass der
Adapter aufruft, was der Adapter aufrufen soll:

1. **`@google-cloud/pubsub` war in `apps/workers` nicht deklariert.** Der Client wird
   über einen Variablen-Spezifizierer geladen, damit TypeScript ihn nicht statisch
   auflöst — dadurch fiel das fehlende Manifest weder beim Typecheck noch beim Build
   auf. In Cloud Run setzt Terraform `PUBSUB_TOPIC` immer, und der Worker bricht dann
   fail-closed ab. Der Startfehler wäre erst im Deployment sichtbar geworden.

2. **Der Out-of-order-Schutz der Projektion war ein Read-Modify-Write.** Ein
   Abonnement stellt gleichzeitig zu, und die Kapazitätstabelle sieht vier
   Projektions-Instanzen vor. Zwei Transaktionen lasen denselben `last_sequence`,
   beide hielten ihre Nachricht für die neuere, die zuletzt schreibende gewann —
   der Zähler blieb hinter der höchsten angewandten Sequenz zurück. Der *Zustand*
   war trotzdem korrekt, weil die Projektion aus der Primärquelle liest statt aus
   dem Payload fortzuschreiben; der Schutz war aber schwächer als sein Name.
   Er entscheidet jetzt in einer Anweisung
   (`ON CONFLICT DO UPDATE … WHERE last_sequence < EXCLUDED.last_sequence`) unter
   der Zeilensperre, die der Konflikt ohnehin nimmt.

Nachgestellt mit drei gleichzeitigen Zustellungen: drei Ereignisse in die Outbox,
drei über den echten Client zugestellt, zwei angewandt und eines korrekt als
`STALE` abgewiesen — Read Model `belegt=3/10`, `last_sequence=3`.
