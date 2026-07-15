import { describe, expect, it } from 'vitest';
import { MockPaymentProvider, createPaymentProvider } from './index.js';

describe('MockPaymentProvider', () => {
  it('ist idempotent pro Schlüssel', async () => {
    const p = new MockPaymentProvider();
    const a = await p.createFundingIntent({ amountCents: 10_000, currency: 'eur', idempotencyKey: 'k1' });
    const b = await p.createFundingIntent({ amountCents: 10_000, currency: 'eur', idempotencyKey: 'k1' });
    expect(b.providerRef).toBe(a.providerRef);
    expect(b.clientSecret).toBe(a.clientSecret);
  });

  it('lehnt nicht-positive Beträge ab', async () => {
    const p = new MockPaymentProvider();
    await expect(
      p.createFundingIntent({ amountCents: 0, currency: 'eur', idempotencyKey: 'k2' }),
    ).rejects.toThrow();
  });

  it('failNext lässt genau den nächsten Aufruf fehlschlagen', async () => {
    const p = new MockPaymentProvider();
    p.failNext();
    await expect(
      p.createFundingIntent({ amountCents: 100, currency: 'eur', idempotencyKey: 'k3' }),
    ).rejects.toThrow();
    // Danach wieder normal.
    const ok = await p.createFundingIntent({ amountCents: 100, currency: 'eur', idempotencyKey: 'k4' });
    expect(ok.status).toBe('requires_payment');
  });
});

describe('createPaymentProvider', () => {
  it('liefert den Mock bei deaktiviertem Echtgeld', () => {
    expect(createPaymentProvider({ REAL_MONEY_ENABLED: false })).toBeInstanceOf(MockPaymentProvider);
  });

  it('wirft hart bei aktiviertem Echtgeld (kein Live-Provider)', () => {
    expect(() => createPaymentProvider({ REAL_MONEY_ENABLED: true })).toThrow();
  });
});
