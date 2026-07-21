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

export interface EvidenceStorageProvider {
  readonly kind: 'mock' | 'gcs' | 's3';
  createUpload(params: CreateUploadParams): Promise<EvidenceUploadTarget>;
}
