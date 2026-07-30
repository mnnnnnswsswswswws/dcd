/**
 * Abstraktion für die Ablage von In-App-Beweisaufnahmen. Der Mock erzeugt eine
 * lokale Referenz ohne Netzwerk; ein echter Provider (z. B. GCS/S3 mit signierter
 * Upload-URL) implementiert dieselbe Schnittstelle und wird per Factory eingehängt.
 */
export interface EvidenceUploadTarget {
  /** Stabiler Schlüssel des Objekts im Storage (nicht rätbar). */
  storageKey: string;
  /** Ziel-URL für den Direktupload aus der App (Mock: Platzhalter). */
  uploadUrl: string;
  /** Ablaufzeitpunkt der Upload-Erlaubnis. */
  expiresAt: Date;
}

export interface CreateUploadParams {
  challengeId: string;
  participantId: string;
  contentType: string;
}

/** Was im Storage über ein Objekt bekannt ist. `null` = nicht vorhanden. */
export interface StoredObject {
  readonly sizeBytes: number;
  readonly contentType: string | null;
}

export interface EvidenceStorageProvider {
  readonly kind: 'mock' | 'gcs' | 's3';
  createUpload(params: CreateUploadParams): Promise<EvidenceUploadTarget>;
  /**
   * Prüft, ob das Objekt tatsächlich abgelegt wurde.
   *
   * Ohne diese Prüfung wird der Client beim Wort genommen: Er bekommt eine
   * signierte Upload-URL, meldet die Einsendung — und niemand stellt fest, ob je
   * Bytes ankamen. Eine Einsendung ohne Beweisvideo würde bis zur Gewinnerauswahl
   * unbemerkt bleiben.
   *
   * Absichtlich getrennt vom Einreichen: Die Prüfung ist ein Netzwerkaufruf und
   * gehört nicht in die Transaktion, die den Slot hält.
   */
  statObject(storageKey: string): Promise<StoredObject | null>;
}
