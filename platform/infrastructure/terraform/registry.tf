# Artifact Registry für das gemeinsame Anwendungs-Image.
#
# Ein Image bedient alle Prozesse (siehe Dockerfile); unterschieden wird über
# `args`. Das hält den Rollout atomar: API, Worker und Migration laufen garantiert
# auf demselben Stand, statt in einer halb migrierten Mischung.

resource "google_artifact_registry_repository" "app" {
  location      = var.region
  repository_id = "vcp"
  format        = "DOCKER"
  description   = "Anwendungs-Images der Challenge-Plattform."

  docker_config {
    # Ein bereits ausgerolltes Tag darf nicht überschrieben werden — sonst zeigt
    # ein Rollback auf ein anderes Image als beim ursprünglichen Rollout.
    immutable_tags = true
  }

  cleanup_policies {
    id     = "alte-versionen"
    action = "DELETE"
    condition {
      # 90 Tage: deutlich länger als jedes realistische Rollback-Fenster.
      older_than = "7776000s"
    }
  }

  cleanup_policies {
    id     = "letzte-behalten"
    action = "KEEP"
    most_recent_versions {
      keep_count = 20
    }
  }

  depends_on = [google_project_service.required]
}

# Jede Dienstidentität muss ihr Image ziehen können.
resource "google_artifact_registry_repository_iam_member" "puller" {
  for_each = merge(
    { for k, v in var.services : k => google_service_account.service[k].email },
    { "migrate" = google_service_account.migrate.email },
  )

  location   = google_artifact_registry_repository.app.location
  repository = google_artifact_registry_repository.app.name
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${each.value}"
}
