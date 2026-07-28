# Cloud-Run-Dienste mit abgeleiteter Kapazität (Scale S1, Aufgabe 12).
#
# Architekturregel 9: Maximalinstanzen folgen aus DB-, Redis- und Providerkapazität.
# Die `precondition` unten setzt das durch — ein `terraform plan` schlägt fehl, bevor
# eine zu hohe Instanzzahl die Datenbank aussperren kann. Dieselbe Rechnung läuft als
# CI-Test in packages/capacity, damit der Fehler schon vor dem Plan auffällt.

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
  }
}

resource "google_cloud_run_v2_service" "service" {
  for_each = var.services

  name     = each.key
  location = var.region

  # Der Guard muss vor jedem Dienst ausgewertet werden.
  depends_on = [terraform_data.capacity_budget_guard]

  template {
    # min_instances bewusst 0 für Worker (Cloud Scheduler triggert), 1 für die API,
    # damit der erste Request keinen Kaltstart sieht.
    scaling {
      min_instance_count = startswith(each.key, "worker-") ? 0 : 1
      max_instance_count = each.value.max_instances
    }

    max_instance_request_concurrency = each.value.concurrency

    containers {
      image = lookup(var.image_tags, each.key, "gcr.io/${var.project_id}/${each.key}:latest")

      # Poolgrößen als Umgebungsvariable: Die Anwendung darf sie nicht selbst raten,
      # sonst weicht die Laufzeit vom hier geprüften Budget ab.
      env {
        name  = "DB_POOL_SIZE"
        value = tostring(each.value.db_pool_size)
      }
      env {
        name  = "REDIS_POOL_SIZE"
        value = tostring(each.value.redis_pool_size)
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }
  }
}
