# Laufzeit: HTTP-Dienste als Cloud-Run-Services, Worker als Cloud-Run-Jobs.
#
# Die Trennung ist keine Stilfrage. Die Worker in apps/workers/src/*.ts sind
# Polling-Prozesse **ohne HTTP-Listener**. Cloud Run erwartet von einem Service,
# dass er innerhalb der Startup-Frist auf $PORT hört — ein Worker als Service
# scheitert deshalb zuverlässig am Startup-Probe, ohne dass die Ursache im Log
# steht. Als Job mit `--once` und Cloud-Scheduler-Trigger läuft derselbe Code
# unverändert und mit sichtbarem Erfolgs-/Fehlerstatus je Lauf.

locals {
  image_default = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.app.repository_id}"

  # Redis-URL nur für Dienste, die überhaupt einen Redis-Pool haben. Ein Dienst
  # ohne Pool bekommt die Variable nicht — sonst verbindet er sich, weil sie da ist.
  redis_url = "redis://${google_redis_instance.cache.host}:${google_redis_instance.cache.port}"

  # Prozessspezifische Argumente. Ein Image, unterschiedliche `args`.
  service_args = {
    "api"               = ["pnpm", "--filter", "@vcp/api", "start"]
    "admin"             = ["pnpm", "--filter", "@vcp/admin", "start"]
    "web"               = ["pnpm", "--filter", "@vcp/web", "start"]
    "worker-outbox"     = ["pnpm", "--filter", "@vcp/workers", "worker:outbox", "--", "--once"]
    "worker-sweeps"     = ["pnpm", "--filter", "@vcp/workers", "worker:all", "--", "--once"]
    "worker-projection" = ["pnpm", "--filter", "@vcp/workers", "worker:projection", "--", "--once"]
  }

  # Nicht-geheime Umgebung je Dienst.
  service_env = {
    for name, s in var.services : name => merge(
      {
        NODE_ENV = "production"
        # Die Anwendung darf die Poolgröße nicht raten (apps/api/src/prisma/pool-url.ts):
        # Ein geratener Wert weicht vom hier geprüften Verbindungsbudget ab.
        DB_POOL_SIZE    = tostring(s.db_pool_size)
        REDIS_POOL_SIZE = tostring(s.redis_pool_size)
      },
      s.redis_pool_size > 0 ? { REDIS_URL = local.redis_url } : {},
      name == "worker-outbox" ? { PUBSUB_TOPIC = google_pubsub_topic.challenge_events.name } : {},
      name == "worker-projection" ? { PUBSUB_SUBSCRIPTION = google_pubsub_subscription.projection.name } : {},
    )
  }

  # Geheime Umgebung je Dienst — Werte kommen aus Secret Manager, nie aus dem State.
  # DATABASE_URL nur, wo auch ein DB-Pool existiert (siehe local.needs_db in iam.tf).
  service_secret_env = {
    for name, s in var.services : name => merge(
      s.db_pool_size > 0 ? { DATABASE_URL = "database-url" } : {},
      name == "api" ? { WEBHOOK_SECRET = "webhook-secret" } : {},
    )
  }
}

# --------------------------------------------------------------------------
# HTTP-Dienste
# --------------------------------------------------------------------------

resource "google_cloud_run_v2_service" "service" {
  for_each = local.http_services

  name     = each.key
  location = var.region

  # Der Guard muss vor jedem Dienst ausgewertet werden.
  depends_on = [
    terraform_data.capacity_budget_guard,
    google_project_iam_member.service,
    google_secret_manager_secret_iam_member.reader,
  ]

  template {
    service_account = google_service_account.service[each.key].email

    scaling {
      # min_instance_count 1: Der erste Request soll keinen Kaltstart sehen.
      min_instance_count = 1
      max_instance_count = each.value.max_instances
    }

    max_instance_request_concurrency = each.value.concurrency

    dynamic "vpc_access" {
      for_each = contains(keys(local.needs_vpc), each.key) ? [1] : []
      content {
        connector = google_vpc_access_connector.main.id
        # Nur private Ziele durch den Connector; ausgehender Internetverkehr
        # geht weiter direkt und belastet den Connector nicht.
        egress = "PRIVATE_RANGES_ONLY"
      }
    }

    # Nur Dienste mit DB-Pool bekommen den Auth-Proxy-Socket. admin und web laufen
    # ohne — sie könnten die Datenbank auch dann nicht erreichen, wenn sie wollten.
    dynamic "volumes" {
      for_each = contains(keys(local.needs_db), each.key) ? [1] : []
      content {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [google_sql_database_instance.main.connection_name]
        }
      }
    }

    containers {
      image = lookup(var.image_tags, each.key, "${local.image_default}/${each.key}:latest")
      args  = local.service_args[each.key]

      dynamic "env" {
        for_each = local.service_env[each.key]
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = local.service_secret_env[each.key]
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret = google_secret_manager_secret.app[env.value].secret_id
              # `latest`: Eine Secret-Rotation greift beim nächsten Start, ohne
              # dass Terraform laufen muss.
              version = "latest"
            }
          }
        }
      }

      dynamic "volume_mounts" {
        for_each = contains(keys(local.needs_db), each.key) ? [1] : []
        content {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      startup_probe {
        # Bei der API prüft /health zusätzlich die DB-Erreichbarkeit — ein Dienst,
        # der die Datenbank nicht erreicht, soll keinen Verkehr bekommen. Die
        # Next.js-Frontends haben keinen solchen Endpunkt und werden auf / geprüft.
        http_get {
          path = each.key == "api" ? "/health" : "/"
        }
        initial_delay_seconds = 10
        period_seconds        = 5
        timeout_seconds       = 3
        failure_threshold     = 12
      }
    }
  }
}

# --------------------------------------------------------------------------
# Worker-Jobs
# --------------------------------------------------------------------------

resource "google_cloud_run_v2_job" "worker" {
  for_each = local.job_services

  name     = each.key
  location = var.region

  depends_on = [
    terraform_data.capacity_budget_guard,
    google_project_iam_member.service,
    google_secret_manager_secret_iam_member.reader,
  ]

  template {
    # Parallelität je Lauf aus dem Durchsatzbudget (packages/capacity), nicht fest
    # auf 1. Die Kapazitätstabelle budgetierte vier Publisher, Terraform startete
    # einen — "budgetiert" und "läuft" waren zwei verschiedene Dinge, und nur eines
    # davon stand irgendwo geschrieben.
    #
    # `FOR UPDATE SKIP LOCKED` in packages/outbox macht die Parallelität sicher:
    # Zwei Läufer greifen nie denselben Eintrag.
    task_count  = lookup(var.worker_parallelism, each.key, 1)
    parallelism = lookup(var.worker_parallelism, each.key, 1)

    template {
      service_account = google_service_account.service[each.key].email
      # Ein `--once`-Lauf ist kurz. Länger als 15 Minuten bedeutet, dass etwas
      # hängt — dann lieber abbrechen und neu starten als blockieren.
      timeout = "900s"
      # Der nächste Scheduler-Lauf greift ohnehin dieselben Einträge erneut
      # (Checkpoint bzw. Visibility Timeout); Wiederholungen im Job sind unnötig.
      max_retries = 0

      dynamic "vpc_access" {
        for_each = contains(keys(local.needs_vpc), each.key) ? [1] : []
        content {
          connector = google_vpc_access_connector.main.id
          egress    = "PRIVATE_RANGES_ONLY"
        }
      }

      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [google_sql_database_instance.main.connection_name]
        }
      }

      containers {
        image = lookup(var.image_tags, each.key, "${local.image_default}/api:latest")
        args  = local.service_args[each.key]

        dynamic "env" {
          for_each = local.service_env[each.key]
          content {
            name  = env.key
            value = env.value
          }
        }

        dynamic "env" {
          for_each = local.service_secret_env[each.key]
          content {
            name = env.key
            value_source {
              secret_key_ref {
                secret  = google_secret_manager_secret.app[env.value].secret_id
                version = "latest"
              }
            }
          }
        }

        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
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
}

resource "google_cloud_scheduler_job" "worker" {
  for_each = local.job_services

  name        = "run-${each.key}"
  region      = var.region
  schedule    = var.worker_schedules[each.key]
  time_zone   = "Europe/Berlin"
  description = "Startet den Cloud-Run-Job ${each.key}."

  attempt_deadline = "320s"

  retry_config {
    retry_count = 1
  }

  http_target {
    http_method = "POST"
    uri         = "https://${var.region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${var.project_id}/jobs/${google_cloud_run_v2_job.worker[each.key].name}:run"

    oauth_token {
      service_account_email = google_service_account.scheduler.email
    }
  }

  depends_on = [
    google_project_service.required,
    google_cloud_run_v2_job_iam_member.scheduler_invoker,
  ]
}

# --------------------------------------------------------------------------
# Migration
# --------------------------------------------------------------------------

# Kein Scheduler: Der Job wird vor jedem Rollout einmal ausgeführt
# (`gcloud run jobs execute migrate --wait`, siehe docs/runbooks/DEPLOY_GCP.md).
# Automatisch mitlaufen zu lassen wäre gefährlich — eine Migration soll ein
# bewusster Schritt sein, kein Nebeneffekt eines Deployments.
resource "google_cloud_run_v2_job" "migrate" {
  name     = "migrate"
  location = var.region

  template {
    task_count  = 1
    parallelism = 1

    template {
      service_account = google_service_account.migrate.email
      timeout         = "1800s"
      max_retries     = 0

      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [google_sql_database_instance.main.connection_name]
        }
      }

      containers {
        image = lookup(var.image_tags, "migrate", "${local.image_default}/api:latest")
        args  = ["pnpm", "exec", "prisma", "migrate", "deploy"]

        env {
          name  = "NODE_ENV"
          value = "production"
        }

        # `prisma migrate deploy` verlangt eine ungepoolte Verbindung; die
        # Laufzeitdienste bekommen DIRECT_URL bewusst nicht (siehe secrets.tf).
        dynamic "env" {
          for_each = toset(["DATABASE_URL", "DIRECT_URL"])
          content {
            name = env.key
            value_source {
              secret_key_ref {
                secret  = google_secret_manager_secret.app[replace(lower(env.key), "_", "-")].secret_id
                version = "latest"
              }
            }
          }
        }

        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }

        resources {
          limits = {
            cpu    = "1"
            memory = "1Gi"
          }
        }
      }
    }
  }

  depends_on = [
    google_project_iam_member.migrate,
    google_secret_manager_secret_iam_member.migrate,
  ]
}
