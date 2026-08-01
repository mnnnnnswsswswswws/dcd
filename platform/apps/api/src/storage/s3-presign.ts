import { createHash, createHmac } from 'node:crypto';

/**
 * Erzeugt eine **presignte** S3-PUT-URL nach AWS Signature Version 4 — ohne SDK, nur
 * mit `node:crypto`. Funktioniert mit AWS S3 und S3-kompatiblen Stores (Cloudflare R2,
 * MinIO, Backblaze B2). Der Upload-Body wird als `UNSIGNED-PAYLOAD` signiert, sodass der
 * Client die Aufnahme direkt per HTTP PUT auf die URL laden kann.
 */
export interface S3PresignParams {
  endpoint: string; // z. B. https://s3.eu-central-1.amazonaws.com oder https://<acct>.r2.cloudflarestorage.com
  region: string;
  bucket: string;
  key: string;
  accessKeyId: string;
  secretAccessKey: string;
  method?: string; // Default PUT
  expiresSeconds: number;
  forcePathStyle?: boolean;
  now?: Date;
}

const SERVICE = 's3';
const ALGORITHM = 'AWS4-HMAC-SHA256';

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

/** RFC-3986-Encoding (strenger als encodeURIComponent — auch `!'()*`). */
export function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Encodet einen Objektschlüssel, behält aber `/` als Segmenttrenner. */
export function encodeS3Key(key: string): string {
  return key
    .split('/')
    .map((segment) => encodeRfc3986(segment))
    .join('/');
}

function amzDates(now: Date): { amzDate: string; dateStamp: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  // iso: YYYYMMDDTHHMMSSZ
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

export interface PresignedTarget {
  url: string;
  host: string;
  amzDate: string;
}

export function presignS3PutUrl(params: S3PresignParams): PresignedTarget {
  const method = params.method ?? 'PUT';
  const now = params.now ?? new Date();
  const { amzDate, dateStamp } = amzDates(now);

  const endpoint = new URL(params.endpoint);
  const baseHost = endpoint.host;
  const scheme = endpoint.protocol.replace(':', '');

  const encodedKey = encodeS3Key(params.key);
  let host: string;
  let canonicalUri: string;
  if (params.forcePathStyle) {
    host = baseHost;
    canonicalUri = `/${params.bucket}/${encodedKey}`;
  } else {
    host = `${params.bucket}.${baseHost}`;
    canonicalUri = `/${encodedKey}`;
  }

  const credentialScope = `${dateStamp}/${params.region}/${SERVICE}/aws4_request`;

  const queryParams: Record<string, string> = {
    'X-Amz-Algorithm': ALGORITHM,
    'X-Amz-Credential': `${params.accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(params.expiresSeconds),
    'X-Amz-SignedHeaders': 'host',
  };

  const canonicalQuery = Object.entries(queryParams)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${encodeRfc3986(k)}=${encodeRfc3986(v)}`)
    .join('&');

  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = 'host';
  const payloadHash = 'UNSIGNED-PAYLOAD';

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const stringToSign = [ALGORITHM, amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');

  const kDate = hmac(`AWS4${params.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, params.region);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  const url = `${scheme}://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  return { url, host, amzDate };
}
