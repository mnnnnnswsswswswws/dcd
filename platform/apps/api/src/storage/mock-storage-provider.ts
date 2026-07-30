import { randomUUID } from 'node:crypto';
import type {
  CreateUploadParams,
  EvidenceStorageProvider,
  EvidenceUploadTarget,
  StoredObject,
} from './storage-provider.js';

const UPLOAD_TTL_MS = 15 * 60 * 1000;

/**
 * Mock-Storage: keine echten Bytes, kein Netzwerk. Liefert einen eindeutigen
 * Schlüssel und eine Platzhalter-Upload-URL, damit der Capture-/Einreich-Fluss
 * ohne externe Credentials vollständig durchlaufen und getestet werden kann.
 */
export class MockEvidenceStorageProvider implements EvidenceStorageProvider {
  readonly kind = 'mock' as const;

  /**
   * Abgelegte Objekte. Der Mock erfindet **nicht**, dass jedes Objekt existiert:
   * Ein Schlüssel gilt erst als hochgeladen, wenn `putForTest` ihn eingetragen hat.
   * Andernfalls würde der Verifikationspfad im Test immer gelingen und damit genau
   * den Fall nie prüfen, für den er gebaut ist.
   */
  private readonly objects = new Map<string, StoredObject>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async createUpload(params: CreateUploadParams): Promise<EvidenceUploadTarget> {
    const storageKey = `evidence/${params.challengeId}/${params.participantId}/${randomUUID()}`;
    return {
      storageKey,
      uploadUrl: `mock://upload/${encodeURIComponent(storageKey)}`,
      expiresAt: new Date(this.now().getTime() + UPLOAD_TTL_MS),
    };
  }

  async statObject(storageKey: string): Promise<StoredObject | null> {
    return this.objects.get(storageKey) ?? null;
  }

  /** Stellt einen erfolgreichen Upload nach — nur für Tests und lokale Läufe. */
  putForTest(storageKey: string, object: StoredObject = { sizeBytes: 1024, contentType: 'video/mp4' }): void {
    this.objects.set(storageKey, object);
  }
}
