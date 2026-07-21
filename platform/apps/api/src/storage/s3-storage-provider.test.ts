import { describe, expect, it } from 'vitest';
import { S3EvidenceStorageProvider } from './s3-storage-provider.js';

const config = {
  endpoint: 'https://s3.eu-central-1.amazonaws.com',
  region: 'eu-central-1',
  bucket: 'vcp-evidence',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'secret',
  forcePathStyle: false,
  uploadTtlSeconds: 900,
};

describe('S3EvidenceStorageProvider', () => {
  it('liefert einen presignten PUT-Upload mit challenge-/teilnehmer-basiertem Schlüssel', async () => {
    const now = new Date('2026-07-21T12:00:00Z');
    const provider = new S3EvidenceStorageProvider(config, () => now);
    const target = await provider.createUpload({
      challengeId: 'chal-1',
      participantId: 'user-1',
      contentType: 'video/mp4',
    });

    expect(target.storageKey).toMatch(/^evidence\/chal-1\/user-1\/[0-9a-f-]+\.mp4$/);
    expect(target.uploadUrl).toContain('https://vcp-evidence.s3.eu-central-1.amazonaws.com/');
    expect(target.uploadUrl).toMatch(/X-Amz-Signature=[0-9a-f]{64}$/);
    expect(target.expiresAt.getTime()).toBe(now.getTime() + 900_000);
  });

  it('wählt die Endung anhand des Content-Types', async () => {
    const provider = new S3EvidenceStorageProvider(config);
    const webm = await provider.createUpload({ challengeId: 'c', participantId: 'p', contentType: 'video/webm' });
    expect(webm.storageKey.endsWith('.webm')).toBe(true);
  });
});
