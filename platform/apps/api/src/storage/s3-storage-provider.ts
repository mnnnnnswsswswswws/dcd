import { randomUUID } from 'node:crypto';
import { presignS3PutUrl } from './s3-presign.js';
import type {
  CreateUploadParams,
  EvidenceStorageProvider,
  EvidenceUploadTarget,
  StoredObject,
} from './storage-provider.js';

/** Schmaler HTTP-Port — injizierbar, damit `statObject` ohne Netzwerk testbar bleibt. */
export type FetchLike = (
  url: string,
  init: { method: string },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
}>;

export interface S3StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  uploadTtlSeconds: number;
}

/**
 * S3-kompatibler Evidence-Storage: liefert eine presignte PUT-URL, auf die die App die
 * In-App-Aufnahme direkt hochlädt. Keine SDK-Abhängigkeit (SigV4 über `node:crypto`).
 */
export class S3EvidenceStorageProvider implements EvidenceStorageProvider {
  readonly kind = 's3' as const;

  constructor(
    private readonly config: S3StorageConfig,
    private readonly now: () => Date = () => new Date(),
    private readonly fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
  ) {}

  async createUpload(params: CreateUploadParams): Promise<EvidenceUploadTarget> {
    const ext = params.contentType.includes('mp4') ? 'mp4' : 'webm';
    const storageKey = `evidence/${params.challengeId}/${params.participantId}/${randomUUID()}.${ext}`;
    const issuedAt = this.now();

    const { url } = presignS3PutUrl({
      endpoint: this.config.endpoint,
      region: this.config.region,
      bucket: this.config.bucket,
      key: storageKey,
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      method: 'PUT',
      expiresSeconds: this.config.uploadTtlSeconds,
      forcePathStyle: this.config.forcePathStyle,
      now: issuedAt,
    });

    return {
      storageKey,
      uploadUrl: url,
      expiresAt: new Date(issuedAt.getTime() + this.config.uploadTtlSeconds * 1000),
    };
  }

  /**
   * HEAD auf das Objekt über eine kurzlebig signierte URL.
   *
   * Kurze Gültigkeit (60 s), weil die URL nur für diesen einen Aufruf existiert —
   * eine lange gültige Lese-URL für fremde Beweisvideos wäre ein Datenleck, kein
   * Komfortgewinn.
   */
  async statObject(storageKey: string): Promise<StoredObject | null> {
    const { url } = presignS3PutUrl({
      endpoint: this.config.endpoint,
      region: this.config.region,
      bucket: this.config.bucket,
      key: storageKey,
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      method: 'HEAD',
      expiresSeconds: 60,
      forcePathStyle: this.config.forcePathStyle,
      now: this.now(),
    });

    const response = await this.fetchImpl(url, { method: 'HEAD' });
    // 404 heißt: nie hochgeladen. Jeder andere Fehlercode ist ein Storage-Problem
    // und darf nicht als "Objekt fehlt" durchgehen — sonst würde eine gültige
    // Einsendung wegen einer Störung verworfen.
    if (response.status === 404 || response.status === 403) return null;
    if (!response.ok) {
      throw new Error(`HEAD auf ${storageKey} beantwortet mit ${response.status}.`);
    }

    const length = response.headers.get('content-length');
    return {
      sizeBytes: length === null ? 0 : Number.parseInt(length, 10),
      contentType: response.headers.get('content-type'),
    };
  }
}
