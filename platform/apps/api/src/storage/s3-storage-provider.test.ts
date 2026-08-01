import { describe, expect, it } from 'vitest';
import { S3EvidenceStorageProvider, type FetchLike } from './s3-storage-provider.js';

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

describe('statObject', () => {
  const config = {
    endpoint: 'https://s3.eu-central-1.amazonaws.com',
    region: 'eu-central-1',
    bucket: 'vcp-evidence',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    forcePathStyle: false,
    uploadTtlSeconds: 900,
  };
  const now = (): Date => new Date('2026-01-01T00:00:00Z');

  /** Nimmt die angefragte URL auf und antwortet mit dem vorgegebenen Ergebnis. */
  function fakeFetch(
    status: number,
    headers: Record<string, string> = {},
    sink?: { url?: string; method?: string },
  ): FetchLike {
    return async (url, init) => {
      if (sink) {
        sink.url = url;
        sink.method = init.method;
      }
      return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
      };
    };
  }

  it('meldet Größe und Typ eines vorhandenen Objekts', async () => {
    const provider = new S3EvidenceStorageProvider(
      config,
      now,
      fakeFetch(200, { 'content-length': '2400000', 'content-type': 'video/mp4' }),
    );
    expect(await provider.statObject('evidence/a/b/c.mp4')).toEqual({
      sizeBytes: 2_400_000,
      contentType: 'video/mp4',
    });
  });

  it('meldet ein fehlendes Objekt als null', async () => {
    const provider = new S3EvidenceStorageProvider(config, now, fakeFetch(404));
    expect(await provider.statObject('evidence/a/b/fehlt.mp4')).toBeNull();
  });

  it('wirft bei einer Störung, statt "fehlt" zu melden', async () => {
    // Entscheidend: Ein 500er darf nicht als fehlender Beweis durchgehen — sonst
    // verlöre eine gültige Einsendung ihr Video wegen einer Störung des Storage.
    const provider = new S3EvidenceStorageProvider(config, now, fakeFetch(500));
    await expect(provider.statObject('evidence/a/b/c.mp4')).rejects.toThrow(/500/);
  });

  it('signiert einen HEAD-Request mit kurzer Gültigkeit', async () => {
    const sink: { url?: string; method?: string } = {};
    const provider = new S3EvidenceStorageProvider(config, now, fakeFetch(200, {}, sink));
    await provider.statObject('evidence/a/b/c.mp4');

    expect(sink.method).toBe('HEAD');
    expect(sink.url).toContain('X-Amz-Signature=');
    // 60 s: Die URL existiert nur für diesen einen Aufruf. Eine lang gültige
    // Lese-URL für fremde Beweisvideos wäre ein Datenleck.
    expect(sink.url).toContain('X-Amz-Expires=60');
  });
});
