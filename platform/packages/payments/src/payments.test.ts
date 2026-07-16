import { describe, expect, it } from 'vitest';
import {
  MockPaymentProvider,
  MockWebhookVerifier,
  StripePaymentProvider,
  StripeWebhookVerifier,
  createPaymentProvider,
  createWebhookVerifier,
} from './index.js';

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

  it('wirft hart bei aktiviertem Echtgeld ohne gewählten Live-Provider', () => {
    expect(() => createPaymentProvider({ REAL_MONEY_ENABLED: true })).toThrow();
  });

  it('wählt Stripe bei PAYMENTS_PROVIDER=stripe mit Key', () => {
    const p = createPaymentProvider({ PAYMENTS_PROVIDER: 'stripe', REAL_MONEY_ENABLED: false, STRIPE_SECRET_KEY: 'sk_test_x' });
    expect(p).toBeInstanceOf(StripePaymentProvider);
  });

  it('wirft, wenn Stripe gewählt aber kein Key gesetzt ist', () => {
    expect(() => createPaymentProvider({ PAYMENTS_PROVIDER: 'stripe', REAL_MONEY_ENABLED: false })).toThrow();
  });
});

describe('createWebhookVerifier', () => {
  it('liefert den Mock-Verifier im Default', () => {
    expect(createWebhookVerifier({ WEBHOOK_SECRET: 's' })).toBeInstanceOf(MockWebhookVerifier);
  });

  it('liefert den Stripe-Verifier bei PAYMENTS_PROVIDER=stripe', () => {
    const v = createWebhookVerifier({ PAYMENTS_PROVIDER: 'stripe', WEBHOOK_SECRET: 's', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' });
    expect(v).toBeInstanceOf(StripeWebhookVerifier);
  });

  it('wirft, wenn Stripe-Webhook-Secret fehlt', () => {
    expect(() => createWebhookVerifier({ PAYMENTS_PROVIDER: 'stripe', WEBHOOK_SECRET: 's', STRIPE_SECRET_KEY: 'sk_test_x' })).toThrow();
  });
});

describe('MockWebhookVerifier', () => {
  it('verifiziert Secret + Nutzlast und normalisiert das Event', async () => {
    const v = new MockWebhookVerifier('shh');
    const body = JSON.stringify({ type: 'funding.succeeded', providerRef: 'pi_1', amountCents: 10_000 });
    const event = await v.verify(body, { 'x-webhook-secret': 'shh' });
    expect(event).toEqual({ type: 'funding.succeeded', providerRef: 'pi_1', amountCents: 10_000 });
  });

  it('lehnt falsches Secret ab', async () => {
    const v = new MockWebhookVerifier('shh');
    await expect(v.verify('{}', { 'x-webhook-secret': 'nope' })).rejects.toThrow();
  });
});
