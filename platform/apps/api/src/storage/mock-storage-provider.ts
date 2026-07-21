import { randomUUID } from 'node:crypto';
import type {
  CreateUploadParams,
  EvidenceStorageProvider,
  EvidenceUploadTarget,
} from './storage-provider.js';

const UPLOAD_TTL_MS = 15 * 60 * 1000;

/**
 * Mock-Storage: keine echten Bytes, kein Netzwerk. Liefert einen eindeutigen
 * Schlüssel und eine Platzhalter-Upload-URL, damit der Capture-/Einreich-Fluss
 * ohne externe Credentials vollständig durchlaufen und getestet werden kann.
 */
export class MockEvidenceStorageProvider implements EvidenceStorageProvider {
  readonly kind = 'mock' as const;

  constructor(private readonly now: () => Date = () => new Date()) {}

  async createUpload(params: CreateUploadParams): Promise<EvidenceUploadTarget> {
    const storageKey = `evidence/${params.challengeId}/${params.participantId}/${randomUUID()}`;
    return {
      storageKey,
      uploadUrl: `mock://upload/${encodeURIComponent(storageKey)}`,
      expiresAt: new Date(this.now().getTime() + UPLOAD_TTL_MS),
    };
  }
}
