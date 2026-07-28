# Kapazitätsvariablen. Die Werte kommen aus capacity.auto.tfvars.json und werden
# dort aus packages/capacity gespiegelt — Terraform führt keine eigenen Zahlen.

variable "project_id" {
  type        = string
  description = "Google-Cloud-Projekt-ID."
}

variable "region" {
  type        = string
  default     = "europe-west3" # Frankfurt — Startmarkt Deutschland
  description = "Region für Cloud Run und Cloud SQL."
}

variable "db_max_connections" {
  type        = number
  description = "max_connections der PostgreSQL-Instanz."
}

variable "db_reserved_connections" {
  type        = number
  description = "Für Migrationen, Superuser und Diagnose freigehaltene Verbindungen."
}

variable "redis_max_connections" {
  type        = number
  description = "Maximale Verbindungen der Redis-Instanz."
}

variable "redis_reserved_connections" {
  type    = number
  description = "Reserve für Betrieb und Diagnose."
}

variable "services" {
  description = "Kapazität je Cloud-Run-Dienst."
  type = map(object({
    max_instances   = number
    concurrency     = number
    db_pool_size    = number
    redis_pool_size = number
  }))
}

variable "image_tags" {
  type        = map(string)
  default     = {}
  description = "Container-Image je Dienst."
}
