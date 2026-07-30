# Broker für die Outbox-Kette: Domänen-Transaktion → outbox_events → **Pub/Sub** →
# Projektions-Consumer → Read Model.
#
# Zwei Eigenschaften sind hier nicht optional, weil der Code sie voraussetzt:
#
#   1. **Message Ordering.** Der Publisher setzt `orderingKey` auf
#      `${aggregateType}:${aggregateId}` (packages/outbox/src/publishers.ts). Ohne
#      `enable_message_ordering` am Abonnement ignoriert Pub/Sub den Schlüssel und
#      liefert Ereignisse desselben Aggregats in beliebiger Reihenfolge.
#   2. **Dead-Letter-Topic.** Ein dauerhaft scheiternder Eintrag würde sonst endlos
#      wiedergeliefert und die Verarbeitung aller nachfolgenden Ereignisse blockieren.
#
# Die Zustellung bleibt trotzdem *at least once*. Die Reihenfolgegarantie ersetzt
# keine Idempotenz — die liegt in der Inbox (packages/outbox/src/inbox.ts) und bleibt
# die eigentliche Absicherung.

resource "google_pubsub_topic" "challenge_events" {
  name = "challenge-events"

  # Ereignisse bleiben eine Woche abrufbar: genug, um einen Consumer-Ausfall über
  # ein Wochenende zu überstehen, ohne aus der Outbox neu aufbauen zu müssen.
  message_retention_duration = "604800s"

  depends_on = [google_project_service.required]
}

resource "google_pubsub_topic" "dead_letter" {
  name                       = "challenge-events-dead-letter"
  message_retention_duration = "604800s"

  depends_on = [google_project_service.required]
}

resource "google_pubsub_subscription" "projection" {
  name  = "challenge-projection"
  topic = google_pubsub_topic.challenge_events.id

  # Siehe oben: Ohne das ist der orderingKey des Publishers wirkungslos.
  enable_message_ordering = true

  # Die Projektion schreibt Inbox-Zeile und Read Model in einer Transaktion; das
  # ist schnell. 60 s lassen Spielraum für eine langsame Datenbank, ohne dass eine
  # hängende Verarbeitung minutenlang blockiert.
  ack_deadline_seconds       = 60
  message_retention_duration = "604800s"
  retain_acked_messages      = false

  expiration_policy {
    # Nie automatisch löschen: Ein Abonnement, das während eines längeren
    # Consumer-Ausfalls verschwindet, nimmt den Rückstand mit.
    ttl = ""
  }

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  dead_letter_policy {
    dead_letter_topic = google_pubsub_topic.dead_letter.id
    # Fünf Versuche: Was danach noch scheitert, ist kein transienter Fehler mehr
    # und gehört angeschaut, nicht wiederholt.
    max_delivery_attempts = 5
  }

  depends_on = [google_pubsub_topic_iam_member.dead_letter_publisher]
}

# Abonnement für das Dead-Letter-Topic. Ohne das verschwinden die Nachrichten dort
# still nach Ablauf der Aufbewahrung — ein Datenverlust, den niemand bemerkt.
resource "google_pubsub_subscription" "dead_letter" {
  name  = "challenge-events-dead-letter-sub"
  topic = google_pubsub_topic.dead_letter.id

  ack_deadline_seconds       = 600
  message_retention_duration = "604800s"

  expiration_policy {
    ttl = ""
  }
}

# --------------------------------------------------------------------------
# Rechte des Pub/Sub-Dienstkontos für die Dead-Letter-Zustellung.
# Ohne beide Bindungen scheitert die Weiterleitung still, und die Nachricht wird
# stattdessen weiter zugestellt — der Schutz wäre wirkungslos.
# --------------------------------------------------------------------------

locals {
  pubsub_agent = "serviceAccount:service-${data.google_project.this.number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

resource "google_pubsub_topic_iam_member" "dead_letter_publisher" {
  topic  = google_pubsub_topic.dead_letter.id
  role   = "roles/pubsub.publisher"
  member = local.pubsub_agent
}

resource "google_pubsub_subscription_iam_member" "dead_letter_subscriber" {
  subscription = google_pubsub_subscription.projection.id
  role         = "roles/pubsub.subscriber"
  member       = local.pubsub_agent
}
