import { describe, expect, it } from 'vitest';
import { envSchema, parseCorsOrigins } from './index.js';

const base = {
  DATABASE_URL: 'postgresql://vcp:vcp@localhost:5432/vcp?schema=public',
};

describe('env schema', () => {
  it('setzt Flags default auf false und TTL auf 600000', () => {
    const env = envSchema.parse(base);
    expect(env.REAL_MONEY_ENABLED).toBe(false);
    expect(env.PAYOUTS_ENABLED).toBe(false);
    expect(env.SLOT_RESERVATION_TTL_MS).toBe(600_000);
  });

  it('lehnt PAYOUTS_ENABLED ohne REAL_MONEY_ENABLED ab', () => {
    const result = envSchema.safeParse({ ...base, PAYOUTS_ENABLED: 'true' });
    expect(result.success).toBe(false);
  });

  it('akzeptiert PAYOUTS_ENABLED mit REAL_MONEY_ENABLED', () => {
    const result = envSchema.safeParse({
      ...base,
      REAL_MONEY_ENABLED: 'true',
      PAYOUTS_ENABLED: 'true',
    });
    expect(result.success).toBe(true);
  });

  it('lehnt Default-WEBHOOK_SECRET in Produktion ab', () => {
    const result = envSchema.safeParse({ ...base, NODE_ENV: 'production' });
    expect(result.success).toBe(false);
  });

  it('akzeptiert ein echtes WEBHOOK_SECRET in Produktion', () => {
    const result = envSchema.safeParse({ ...base, NODE_ENV: 'production', WEBHOOK_SECRET: 's3cret-value' });
    expect(result.success).toBe(true);
  });

  it('Default-Storage ist mock', () => {
    expect(envSchema.parse(base).STORAGE_PROVIDER).toBe('mock');
  });

  it('lehnt STORAGE_PROVIDER=s3 ohne Credentials ab', () => {
    const result = envSchema.safeParse({ ...base, STORAGE_PROVIDER: 's3' });
    expect(result.success).toBe(false);
  });

  it('akzeptiert STORAGE_PROVIDER=s3 mit vollständiger Konfiguration', () => {
    const result = envSchema.safeParse({
      ...base,
      STORAGE_PROVIDER: 's3',
      STORAGE_S3_ENDPOINT: 'https://s3.eu-central-1.amazonaws.com',
      STORAGE_S3_REGION: 'eu-central-1',
      STORAGE_S3_BUCKET: 'vcp-evidence',
      STORAGE_S3_ACCESS_KEY_ID: 'AKIDEXAMPLE',
      STORAGE_S3_SECRET_ACCESS_KEY: 'secret',
    });
    expect(result.success).toBe(true);
  });
});

describe('parseCorsOrigins', () => {
  it('leer → keine Freigabe', () => {
    expect(parseCorsOrigins({})).toEqual([]);
  });
  it('* → alle', () => {
    expect(parseCorsOrigins({ CORS_ORIGINS: '*' })).toBe('*');
  });
  it('kommagetrennt → Liste', () => {
    expect(parseCorsOrigins({ CORS_ORIGINS: 'http://a.test, http://b.test' })).toEqual(['http://a.test', 'http://b.test']);
  });
});
