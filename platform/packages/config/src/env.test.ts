import { describe, expect, it } from 'vitest';
import { envSchema } from './index.js';

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
});
