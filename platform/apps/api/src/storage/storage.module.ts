import { Global, Module } from '@nestjs/common';
import { loadEnv } from '@vcp/config';
import { MockEvidenceStorageProvider } from './mock-storage-provider.js';
import { S3EvidenceStorageProvider } from './s3-storage-provider.js';
import type { EvidenceStorageProvider } from './storage-provider.js';

/** DI-Token für den Evidence-Storage-Provider. */
export const EVIDENCE_STORAGE = Symbol('EVIDENCE_STORAGE');

/**
 * Wählt den Evidence-Storage per Env (`STORAGE_PROVIDER`). Default ist der Mock
 * (kein Netzwerk/keine Credentials); `s3` bindet den S3-kompatiblen Provider
 * (presignte PUT-URL, SigV4). Die Env-Konsistenz (Endpoint/Bucket/Region/Keys)
 * erzwingt bereits das Config-Schema.
 */
export function createEvidenceStorage(env = loadEnv()): EvidenceStorageProvider {
  if (env.STORAGE_PROVIDER === 's3') {
    return new S3EvidenceStorageProvider({
      endpoint: env.STORAGE_S3_ENDPOINT as string,
      region: env.STORAGE_S3_REGION as string,
      bucket: env.STORAGE_S3_BUCKET as string,
      accessKeyId: env.STORAGE_S3_ACCESS_KEY_ID as string,
      secretAccessKey: env.STORAGE_S3_SECRET_ACCESS_KEY as string,
      forcePathStyle: env.STORAGE_S3_FORCE_PATH_STYLE,
      uploadTtlSeconds: env.STORAGE_S3_UPLOAD_TTL_S,
    });
  }
  return new MockEvidenceStorageProvider();
}

@Global()
@Module({
  providers: [
    {
      provide: EVIDENCE_STORAGE,
      useFactory: () => createEvidenceStorage(),
    },
  ],
  exports: [EVIDENCE_STORAGE],
})
export class StorageModule {}
