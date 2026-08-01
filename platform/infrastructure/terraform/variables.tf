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
  description = "max_connections der PostgreSQL-Instanz. Wird als Cloud-SQL-Flag gesetzt, nicht nur angenommen."
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
  type        = number
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
  description = "Container-Image je Dienst. Ohne Eintrag wird `:latest` aus der Artifact Registry verwendet — für Produktion sollte hier ein unveränderlicher Digest stehen."
}

# --- Datenhaltung ---------------------------------------------------------

variable "db_tier" {
  type        = string
  default     = "db-custom-2-7680"
  description = "Cloud-SQL-Maschinentyp. Muss zu db_max_connections passen: kleine Tiers erlauben weniger Verbindungen."
}

variable "db_availability_type" {
  type        = string
  default     = "REGIONAL"
  description = "REGIONAL = Hochverfügbarkeit mit automatischem Failover. ZONAL ist billiger, hat aber keinen Failover — für eine Plattform mit Ledger und Auszahlungen die falsche Wahl."

  validation {
    condition     = contains(["REGIONAL", "ZONAL"], var.db_availability_type)
    error_message = "db_availability_type muss REGIONAL oder ZONAL sein."
  }
}

variable "redis_tier" {
  type        = string
  default     = "STANDARD_HA"
  description = "STANDARD_HA hat ein Replikat; BASIC verliert bei einem Ausfall den gesamten Cache auf einmal."

  validation {
    condition     = contains(["BASIC", "STANDARD_HA"], var.redis_tier)
    error_message = "redis_tier muss BASIC oder STANDARD_HA sein."
  }
}

variable "redis_memory_gb" {
  type        = number
  default     = 5
  description = "Speichergröße der Memorystore-Instanz in GB."
}

variable "redis_tier_maxclients" {
  type        = number
  default     = 65000
  description = "Dokumentiertes maxclients der gewählten Instanzgröße. Memorystore lässt den Wert nicht setzen — er wird hier nur zur Prüfung geführt und ist mit `gcloud redis instances describe` zu bestätigen."
}

# --- Netz -----------------------------------------------------------------

variable "network_name" {
  type        = string
  default     = "default"
  description = "VPC-Netz für Cloud SQL, Memorystore und den Serverless-Connector."
}

variable "connector_cidr" {
  type        = string
  default     = "10.8.0.0/28"
  description = "/28-Bereich für den VPC-Access-Connector. Darf sich mit keinem Subnetz überschneiden."
}

variable "connector_max_instances" {
  type        = number
  default     = 10
  description = "Maximale Connector-Instanzen. Der Connector ist ein Durchsatzengpass — zu klein bremst Redis-Zugriffe, zu groß kostet ohne Nutzen."
}

# --- Zeitpläne ------------------------------------------------------------

variable "worker_schedules" {
  type = map(string)
  default = {
    # Der Publisher soll dem Anfall dicht folgen: Ereignisse liegen sonst
    # minutenlang in der Outbox, obwohl sie zustellbar wären.
    "worker-outbox" = "* * * * *"
    # Die Projektion hängt am Publisher — gleiche Taktung, sonst wächst der
    # Rückstand zwischen beiden Stufen.
    "worker-projection" = "* * * * *"
    # Früher alle fünf Minuten — das war die Decke: Der Lauf erledigt auch die
    # Beweisprüfung, und 20 Prüfungen je Lauf ergaben 4 Einsendungen pro Minute.
    # Der Takt ist jetzt Teil des Durchsatzbudgets (packages/capacity), nicht mehr
    # eine Bequemlichkeitsentscheidung.
    "worker-sweeps" = "* * * * *"
  }
  description = "Cron-Zeitplan je Worker-Job (Europe/Berlin). Jeder Worker aus var.services braucht einen Eintrag — main.tf erzwingt das."
}

variable "worker_parallelism" {
  type = map(number)
  default = {
    # Muss zu PROCESSORS in packages/capacity passen; ein Test dort vergleicht.
    "worker-outbox"     = 2
    "worker-projection" = 2
    # Die Sweeps sind idempotent, aber ihre Arbeit ist nicht partitioniert —
    # zwei Läufer würden sich hier nur gegenseitig die Sperren wegnehmen.
    "worker-sweeps" = 1
  }
  description = "Gleichzeitige Tasks je Worker-Job. Nicht frei wählbar: Das Verbindungsbudget rechnet mit max_instances x db_pool_size, und die Parallelität ist der Teil davon, der tatsaechlich laeuft."
}
