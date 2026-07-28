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
