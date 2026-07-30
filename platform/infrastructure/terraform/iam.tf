# Eine Dienstidentität je Cloud-Run-Dienst, mit genau den Rechten, die dieser
# Dienst braucht.
#
# Der Grund für getrennte Identitäten statt der Default-Compute-SA: Der
# Projektions-Consumer darf lesen, was der Publisher schreibt — aber er darf nicht
# selbst publizieren. Mit einer geteilten Identität wäre dieser Unterschied nicht
# durchsetzbar, sondern nur eine Absichtserklärung im Code.

locals {
  # Rollen, die jeder Dienst braucht, um überhaupt beobachtbar zu sein.
  base_roles = [
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
  ]

  # Broker-Rechte sind asymmetrisch und deshalb explizit: Der Projektions-Consumer
  # darf lesen, was der Publisher schreibt — aber nicht selbst publizieren. Genau
  # diese Trennung ginge mit einer geteilten Identität verloren.
  broker_roles = {
    "worker-outbox"     = ["roles/pubsub.publisher"]
    "worker-projection" = ["roles/pubsub.subscriber"]
  }

  # Datenbankzugriff wird **abgeleitet**, nicht gepflegt: Ein Dienst mit
  # db_pool_size = 0 spricht nicht mit der Datenbank und bekommt deshalb weder
  # cloudsql.client noch das DATABASE_URL-Secret noch den Cloud-SQL-Mount. Die
  # Kapazitätszahl ist damit auch die Rechtequelle — zwei getrennte Listen wären
  # zwei Gelegenheiten, sie auseinanderlaufen zu lassen.
  needs_db = { for k, v in var.services : k => v if v.db_pool_size > 0 }

  # Projektweite Rollen je Dienst. Secret-Zugriff wird bewusst *nicht* hier
  # vergeben, sondern pro Secret (secrets.tf) — projektweiter secretAccessor
  # gäbe jedem Dienst auch die Secrets aller anderen.
  service_roles = {
    for name, s in var.services : name => concat(
      local.base_roles,
      s.db_pool_size > 0 ? ["roles/cloudsql.client"] : [],
      lookup(local.broker_roles, name, []),
    )
  }

  # Flachgeklopft für for_each: ein Eintrag je (Dienst, Rolle).
  service_role_bindings = merge([
    for service, roles in local.service_roles : {
      for role in roles : "${service}:${role}" => { service = service, role = role }
    }
  ]...)
}

resource "google_service_account" "service" {
  for_each = var.services

  # Cloud-Run-Dienstnamen sind bereits kleingeschrieben und bindestrichgetrennt;
  # das Account-ID-Format (6–30 Zeichen) verträgt sie unverändert.
  account_id   = each.key
  display_name = "Cloud Run ${each.key}"
  description  = "Dienstidentität für ${each.key}. Rechte in iam.tf, nicht von Hand erweitern."

  depends_on = [google_project_service.required]
}

resource "google_project_iam_member" "service" {
  for_each = local.service_role_bindings

  project = var.project_id
  role    = each.value.role
  member  = "serviceAccount:${google_service_account.service[each.value.service].email}"
}

# --------------------------------------------------------------------------
# Scheduler-Identität: darf Worker-Jobs starten, sonst nichts.
# --------------------------------------------------------------------------

resource "google_service_account" "scheduler" {
  account_id   = "worker-scheduler"
  display_name = "Cloud Scheduler → Cloud Run Jobs"
  description  = "Startet die Worker-Jobs. Keine Datenbank-, Secret- oder Broker-Rechte."

  depends_on = [google_project_service.required]
}

resource "google_cloud_run_v2_job_iam_member" "scheduler_invoker" {
  for_each = local.job_services

  name     = google_cloud_run_v2_job.worker[each.key].name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}
