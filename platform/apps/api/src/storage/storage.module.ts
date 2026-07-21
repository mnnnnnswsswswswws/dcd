import { Global, Module } from '@nestjs/common';
import { MockEvidenceStorageProvider } from './mock-storage-provider.js';

/** DI-Token für den Evidence-Storage-Provider. */
export const EVIDENCE_STORAGE = Symbol('EVIDENCE_STORAGE');

/**
 * Bindet den Evidence-Storage. Default ist der Mock (kein Netzwerk/keine Credentials);
 * ein echter Provider (GCS/S3) wird hier per Factory eingehängt, sobald konfiguriert.
 */
@Global()
@Module({
  providers: [
    {
      provide: EVIDENCE_STORAGE,
      useFactory: () => new MockEvidenceStorageProvider(),
    },
  ],
  exports: [EVIDENCE_STORAGE],
})
export class StorageModule {}
