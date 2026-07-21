import { describe, expect, it } from 'vitest';
import { encodeRfc3986, encodeS3Key, presignS3PutUrl } from './s3-presign.js';

/**
 * Der Presigner ist handgeschrieben (SigV4 über node:crypto). Der wichtigste Test ist
 * daher ein Known-Answer-Test gegen das offizielle AWS-Beispiel für presignte
 * Query-Parameter (GET examplebucket/test.txt), das genau `UNSIGNED-PAYLOAD` signiert.
 */
describe('presignS3PutUrl — AWS-Known-Answer-Test', () => {
  it('reproduziert die AWS-Beispielsignatur', () => {
    const { url } = presignS3PutUrl({
      endpoint: 'https://s3.amazonaws.com',
      region: 'us-east-1',
      bucket: 'examplebucket',
      key: 'test.txt',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      method: 'GET',
      expiresSeconds: 86400,
      now: new Date('2013-05-24T00:00:00Z'),
    });
    // Offiziell dokumentierte Signatur des AWS-SigV4-Query-Beispiels.
    expect(url).toContain(
      'X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
    expect(url).toContain('https://examplebucket.s3.amazonaws.com/test.txt?');
    expect(url).toContain('X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request');
    expect(url).toContain('X-Amz-SignedHeaders=host');
  });
});

describe('presignS3PutUrl — Struktur & Optionen', () => {
  const base = {
    endpoint: 'https://s3.eu-central-1.amazonaws.com',
    region: 'eu-central-1',
    bucket: 'vcp-evidence',
    key: 'evidence/c/p/abc.mp4',
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'secret',
    expiresSeconds: 900,
    now: new Date('2026-07-21T12:00:00Z'),
  };

  it('ist deterministisch bei gleichen Eingaben', () => {
    const a = presignS3PutUrl(base);
    const b = presignS3PutUrl(base);
    expect(a.url).toBe(b.url);
  });

  it('nutzt Host-Style per Default und Path-Style bei forcePathStyle', () => {
    const host = presignS3PutUrl(base);
    expect(host.host).toBe('vcp-evidence.s3.eu-central-1.amazonaws.com');
    expect(host.url).toContain('https://vcp-evidence.s3.eu-central-1.amazonaws.com/evidence/c/p/abc.mp4?');

    const path = presignS3PutUrl({ ...base, forcePathStyle: true });
    expect(path.host).toBe('s3.eu-central-1.amazonaws.com');
    expect(path.url).toContain('https://s3.eu-central-1.amazonaws.com/vcp-evidence/evidence/c/p/abc.mp4?');
  });

  it('signiert PUT, setzt Ablauf und Signatur (64 Hex)', () => {
    const { url } = presignS3PutUrl(base);
    expect(url).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
    expect(url).toContain('X-Amz-Expires=900');
    expect(url).toMatch(/X-Amz-Signature=[0-9a-f]{64}$/);
  });

  it('ändert die Signatur, wenn der Schlüssel/Secret sich ändert', () => {
    const a = presignS3PutUrl(base);
    const b = presignS3PutUrl({ ...base, key: 'evidence/c/p/other.mp4' });
    const c = presignS3PutUrl({ ...base, secretAccessKey: 'anders' });
    expect(a.url).not.toBe(b.url);
    expect(a.url).not.toBe(c.url);
  });
});

describe('Encoding-Helfer', () => {
  it('encodeRfc3986 encodet auch !\'()*', () => {
    expect(encodeRfc3986("a!'()*b")).toBe('a%21%27%28%29%2Ab');
    expect(encodeRfc3986('a/b')).toBe('a%2Fb');
  });

  it('encodeS3Key behält / als Segmenttrenner', () => {
    expect(encodeS3Key('evidence/a b/c.mp4')).toBe('evidence/a%20b/c.mp4');
  });
});
