# Kapazitätsgrundlage und Projekt-APIs (Scale S1, Aufgabe 12).
#
# Architekturregel 9: Maximalinstanzen folgen aus DB-, Redis- und Providerkapazität.
# Die `precondition` unten setzt das durch — ein `terraform plan` schlägt fehl, bevor
# eine zu hohe Instanzzahl die Datenbank aussperren kann. Dieselbe Rechnung läuft als
# CI-Test in packages/capacity, damit der Fehler schon vor dem Plan auffällt.
#
# Die eigentlichen Laufzeit-Ressourcen liegen in cloud-run.tf; Datenhaltung, Broker,
# Secrets und Identitäten in den jeweils gleichnamigen Dateien.

terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

data "google_project" "this" {}

# Ohne aktivierte APIs schlägt jede folgende Ressource mit einem unspezifischen
# 403 fehl. Explizit aktivieren macht die Fehlermeldung zur Konfigurationsfrage.
resource "google_project_service" "required" {
  for_each = toset([
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "redis.googleapis.com",
    "pubsub.googleapis.com",
    "secretmanager.googleapis.com",
    "artifactregistry.googleapis.com",
    "vpcaccess.googleapis.com",
    "cloudscheduler.googleapis.com",
    "monitoring.googleapis.com",
    "iam.googleapis.com",
  ])

  service = each.key
  # Beim Zerstören des Stacks bleiben die APIs aktiv: Ein `terraform destroy` soll
  # nicht projektweit andere Dienste mitreißen.
  disable_on_destroy = false
}

locals {
  # Worst Case: alle Instanzen laufen und halten jeweils ihren vollen Pool.
  db_worst_case = sum([
    for name, s in var.services : s.max_instances * s.db_pool_size
  ])
  redis_worst_case = sum([
    for name, s in var.services : s.max_instances * s.redis_pool_size
  ])

  db_available    = var.db_max_connections - var.db_reserved_connections
  redis_available = var.redis_max_connections - var.redis_reserved_connections

  # Worker sind Polling-Prozesse ohne HTTP-Listener (apps/workers/src/*.ts). Als
  # Cloud-Run-Service würden sie den Startup-Probe nicht bestehen — sie laufen
  # deshalb als Jobs, angestoßen von Cloud Scheduler mit `--once`.
  http_services = { for k, v in var.services : k => v if !startswith(k, "worker-") }
  job_services  = { for k, v in var.services : k => v if startswith(k, "worker-") }

  # Dienste mit Redis-Pool brauchen Netzzugang in die VPC (Memorystore hat nur
  # private IPs). Alle anderen laufen ohne Connector — weniger Angriffsfläche.
  needs_vpc = { for k, v in var.services : k => v if v.redis_pool_size > 0 }
}

# Verbindungsbudget als harte Vorbedingung — nicht als Kommentar.
resource "terraform_data" "capacity_budget_guard" {
  input = {
    db    = local.db_worst_case
    redis = local.redis_worst_case
  }

  lifecycle {
    precondition {
      condition     = local.db_worst_case <= local.db_available
      error_message = "DB-Verbindungsbudget überschritten: ${local.db_worst_case} benötigt, ${local.db_available} verfügbar. Entweder max_instances senken, db_pool_size verkleinern oder die Datenbank skalieren."
    }
    precondition {
      condition     = local.redis_worst_case <= local.redis_available
      error_message = "Redis-Verbindungsbudget überschritten: ${local.redis_worst_case} benötigt, ${local.redis_available} verfügbar."
    }
    # Ein neuer Dienst in der Kapazitätstabelle ohne eigenen Startbefehl würde das
    # Default-Kommando des Images ausführen — also einen zweiten API-Server, der
    # unter fremdem Namen läuft und Verbindungen verbraucht.
    precondition {
      condition     = length(setsubtract(keys(var.services), keys(local.service_args))) == 0
      error_message = "Dienst ohne Startbefehl: ${join(", ", setsubtract(keys(var.services), keys(local.service_args)))} fehlt in local.service_args (cloud-run.tf)."
    }
    # Jeder Worker-Job braucht einen Zeitplan, sonst läuft er nie und der Rückstand
    # wächst unbemerkt — genau die Art Ausfall, die niemand sieht.
    precondition {
      condition     = length(setsubtract(keys(local.job_services), keys(var.worker_schedules))) == 0
      error_message = "Worker ohne Zeitplan: ${join(", ", setsubtract(keys(local.job_services), keys(var.worker_schedules)))} fehlt in var.worker_schedules."
    }
  }
}
