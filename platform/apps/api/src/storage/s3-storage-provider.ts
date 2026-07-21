import { randomUUID } from 'node:crypto';
import { presignS3PutUrl } from './s3-presign.js';
import type {
  CreateUploadParams,
  EvidenceStorageProvider,
  EvidenceUploadTarget,
} from './storage-provider.js';

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
}
