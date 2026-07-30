# Secret-Container ohne Werte.
#
# Terraform legt die Secrets an und vergibt den Lesezugriff — die **Werte** kommen
# nie aus dieser Konfiguration. Ein Secret-Wert im Terraform-Code landet im State,
# und der State ist eine Datei, die kopiert, gebackupt und geteilt wird.
#
# Werte werden außerhalb gesetzt:
#   printf '%s' "$WERT" | gcloud secrets versions add NAME --data-file=-
#
# Ein Dienst startet ohne Secret-Version nicht — das ist gewollt: lieber ein
# sichtbarer Fehlstart als ein Dienst, der mit leerer Konfiguration läuft.

locals {
  # Welcher Dienst welches Secret lesen darf.
  #
  # DIRECT_URL steht bewusst nur beim Migrations-Job: Eine ungepoolte Verbindung
  # gehört nicht in die Laufzeit, sonst umgeht ein Dienst versehentlich das
  # Verbindungsbudget aus packages/capacity.
  secret_readers = {
    # Abgeleitet aus der Poolgröße (iam.tf): Wer nicht mit der Datenbank spricht,
    # bekommt auch die Zugangsdaten nicht. admin und web fallen damit heraus.
    "database-url"   = keys(local.needs_db)
    "webhook-secret" = ["api"]
    "direct-url"     = []
  }

  secret_reader_bindings = merge([
    for secret, services in local.secret_readers : {
      for service in services : "${secret}:${service}" => { secret = secret, service = service }
    }
  ]...)
}

resource "google_secret_manager_secret" "app" {
  for_each = local.secret_readers

  secret_id = each.key

  replication {
    # Nur Deutschland/EU: Die Plattform startet im deutschen Markt, und die
    # Compliance-Annahmen in packages/compliance gehen von EU-Datenhaltung aus.
    user_managed {
      replicas {
        location = var.region
      }
    }
  }

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_iam_member" "reader" {
  for_each = local.secret_reader_bindings

  secret_id = google_secret_manager_secret.app[each.value.secret].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.service[each.value.service].email}"
}

# Der Migrations-Job braucht beide URLs: DIRECT_URL für `prisma migrate deploy`
# (Prisma verlangt für Migrationen eine ungepoolte Verbindung) und DATABASE_URL,
# weil die Datasource sie unabhängig davon auflöst.
resource "google_service_account" "migrate" {
  account_id   = "migrate"
  display_name = "Prisma-Migrationen"
  description  = "Führt `prisma migrate deploy` aus. Einzige Identität mit DIRECT_URL."

  depends_on = [google_project_service.required]
}

resource "google_project_iam_member" "migrate" {
  for_each = toset(["roles/cloudsql.client", "roles/logging.logWriter"])

  project = var.project_id
  role    = each.key
  member  = "serviceAccount:${google_service_account.migrate.email}"
}

resource "google_secret_manager_secret_iam_member" "migrate" {
  for_each = toset(["database-url", "direct-url"])

  secret_id = google_secret_manager_secret.app[each.key].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.migrate.email}"
}
