output "db_connection_budget" {
  description = "Worst-Case-Verbindungen gegen das verfügbare Budget."
  value = {
    used      = local.db_worst_case
    available = local.db_available
    headroom  = local.db_available - local.db_worst_case
  }
}

output "redis_connection_budget" {
  value = {
    used      = local.redis_worst_case
    available = local.redis_available
    headroom  = local.redis_available - local.redis_worst_case
  }
}

output "service_urls" {
  description = "Öffentliche URLs der HTTP-Dienste."
  value       = { for k, s in google_cloud_run_v2_service.service : k => s.uri }
}

output "sql_connection_name" {
  description = "Verbindungsname für den Cloud SQL Auth Proxy. Teil der DATABASE_URL: ...?host=/cloudsql/<dieser Wert>"
  value       = google_sql_database_instance.main.connection_name
}

output "redis_host" {
  description = "Private IP der Memorystore-Instanz."
  value       = google_redis_instance.cache.host
}

output "image_repository" {
  description = "Ziel für `docker push` bzw. `gcloud builds submit --tag`."
  value       = local.image_default
}

output "secrets_to_fill" {
  description = "Secrets, die vor dem ersten Start einen Wert brauchen. Terraform legt nur die Container an — die Werte gehören nie in den State."
  value       = [for k, s in google_secret_manager_secret.app : s.secret_id]
}

output "service_accounts" {
  description = "Dienstidentitäten je Cloud-Run-Dienst."
  value       = merge({ for k, sa in google_service_account.service : k => sa.email }, { migrate = google_service_account.migrate.email })
}
