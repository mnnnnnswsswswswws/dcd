# PostgreSQL und Redis — die beiden Ressourcen, deren Grenzen das Kapazitätsbudget
# in packages/capacity überhaupt erst bezifferbar machen.
#
# Der entscheidende Punkt: `db_max_connections` ist hier keine Annahme über die
# Datenbank, sondern wird als Datenbank-Flag **gesetzt**. Ohne das wäre die Zahl in
# capacity.auto.tfvars.json eine Behauptung — und das Verbindungsbudget würde gegen
# einen Wert rechnen, den niemand durchsetzt.

resource "google_sql_database_instance" "main" {
  name             = "vcp-postgres"
  database_version = "POSTGRES_16"
  region           = var.region

  # Eine Datenbank mit Ledger-Einträgen und Auszahlungen löscht man nicht versehentlich.
  deletion_protection = true

  settings {
    tier              = var.db_tier
    availability_type = var.db_availability_type
    disk_type         = "PD_SSD"
    disk_autoresize   = true

    database_flags {
      name  = "max_connections"
      value = tostring(var.db_max_connections)
    }

    ip_configuration {
      # Kein öffentlicher Endpunkt: Cloud Run verbindet über den Cloud SQL
      # Auth Proxy (Unix-Socket im Container), nicht über das Internet.
      ipv4_enabled                                  = false
      private_network                               = data.google_compute_network.default.id
      enable_private_path_for_google_cloud_services = true
      ssl_mode                                      = "ENCRYPTED_ONLY"
    }

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "02:00"
      location                       = var.region

      backup_retention_settings {
        retained_backups = 14
        retention_unit   = "COUNT"
      }
    }

    maintenance_window {
      # Dienstag früh: außerhalb der Abendspitze, in der Challenges laufen.
      day          = 2
      hour         = 3
      update_track = "stable"
    }

    insights_config {
      query_insights_enabled  = true
      query_string_length     = 1024
      record_application_tags = true
    }
  }

  lifecycle {
    precondition {
      # Cloud SQL reserviert selbst Verbindungen für Systemprozesse. Ein Budget,
      # das die volle max_connections beansprucht, sperrt genau dann aus, wenn es
      # eng wird — also im Lastfall.
      condition     = var.db_reserved_connections >= 10
      error_message = "db_reserved_connections muss mindestens 10 betragen; Cloud SQL belegt selbst Verbindungen für Wartung und Diagnose."
    }
  }

  depends_on = [
    google_project_service.required,
    google_service_networking_connection.private_vpc,
  ]
}

resource "google_sql_database" "app" {
  name     = "vcp"
  instance = google_sql_database_instance.main.name
}

# --------------------------------------------------------------------------
# Netz: private Anbindung für Cloud SQL und Memorystore
# --------------------------------------------------------------------------

data "google_compute_network" "default" {
  name = var.network_name
}

resource "google_compute_global_address" "private_ip" {
  name          = "vcp-private-ip"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = data.google_compute_network.default.id

  depends_on = [google_project_service.required]
}

resource "google_service_networking_connection" "private_vpc" {
  network                 = data.google_compute_network.default.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_ip.name]
}

# Cloud Run erreicht private IPs nur über einen Connector.
resource "google_vpc_access_connector" "main" {
  name          = "vcp-connector"
  region        = var.region
  ip_cidr_range = var.connector_cidr
  network       = var.network_name

  min_instances = 2
  max_instances = var.connector_max_instances

  depends_on = [google_project_service.required]
}

# --------------------------------------------------------------------------
# Memorystore für Redis — Cache-Rolle (packages/cache, RedisRole.CACHE)
# --------------------------------------------------------------------------

resource "google_redis_instance" "cache" {
  name           = "vcp-cache"
  tier           = var.redis_tier
  memory_size_gb = var.redis_memory_gb
  region         = var.region
  redis_version  = "REDIS_7_0"

  authorized_network = data.google_compute_network.default.id
  connect_mode       = "PRIVATE_SERVICE_ACCESS"

  redis_configs = {
    # Muss zur Cache-Rolle in packages/cache/src/redis-roles.ts passen: Der Cache
    # darf verdrängen. Die Koordinationsinstanz dürfte das nicht — sie ist bewusst
    # eine eigene Instanz und nicht dieselbe mit anderem Präfix.
    maxmemory-policy = "allkeys-lru"
  }

  lifecycle {
    precondition {
      # Memorystore lässt `maxclients` nicht konfigurieren; der Wert folgt aus der
      # Instanzgröße. Das Budget muss deshalb deutlich darunter bleiben, statt die
      # Grenze auszureizen — nachprüfbar mit
      #   gcloud redis instances describe vcp-cache --region=REGION
      condition     = var.redis_max_connections <= var.redis_tier_maxclients
      error_message = "redis_max_connections (${var.redis_max_connections}) übersteigt das für diese Instanzgröße dokumentierte maxclients (${var.redis_tier_maxclients})."
    }
  }

  depends_on = [
    google_project_service.required,
    google_service_networking_connection.private_vpc,
  ]
}
