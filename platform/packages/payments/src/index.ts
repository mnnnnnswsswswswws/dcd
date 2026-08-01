/**
 * Zahlungs-Abstraktion.
 *
 * Geld fließt ausschließlich über idempotente Backend-Prozesse. Der `PaymentProvider`
 * kapselt die Erstellung einer Finanzierungs-Absicht (Escrow der Preissumme). Im MVP
 * gibt es nur den `MockPaymentProvider`; ein echter Provider (Stripe Connect) wird
 * erst nach ausdrücklicher Flag-Freigabe angebunden. Beträge ausschließlich in Cent.
 */
import { StripePaymentProvider, StripeWebhookVerifier } from './stripe.js';
import { MockWebhookVerifier, type WebhookVerifier } from './webhook-verifier.js';

export type Currency = 'eur';

export interface CreateFundingIntentParams {
  amountCents: number;
  currency: Currency;
  /** Idempotenzschlüssel — gleiche Eingabe liefert dieselbe Absicht zurück. */
  idempotencyKey: string;
  metadata?: Record<string, string>;
}

export interface FundingIntent {
  providerRef: string;
  clientSecret: string;
  amountCents: number;
  currency: Currency;
  status: 'requires_payment' | 'succeeded';
}

export interface PaymentProvider {
  createFundingIntent(params: CreateFundingIntentParams): Promise<FundingIntent>;
}

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}`;
}

/**
 * In-Memory-Provider für Entwicklung und Tests. Idempotent per Schlüssel; `failNext`
 * simuliert einen Provider-Fehler beim nächsten Aufruf (für Fehlerpfad-Tests).
 */
export class MockPaymentProvider implements PaymentProvider {
  private readonly byKey = new Map<string, FundingIntent>();
  private failNextCreate = false;

  /** Nächsten `createFundingIntent`-Aufruf einmalig fehlschlagen lassen. */
  failNext(): void {
    this.failNextCreate = true;
  }

  async createFundingIntent(params: CreateFundingIntentParams): Promise<FundingIntent> {
    if (this.failNextCreate) {
      this.failNextCreate = false;
      throw new Error('MockPaymentProvider: simulierter Fehler');
    }
    if (!Number.isInteger(params.amountCents) || params.amountCents <= 0) {
      throw new Error('amountCents muss ein positiver Integer (Cent) sein');
    }

    const existing = this.byKey.get(params.idempotencyKey);
    if (existing) {
      return existing;
    }

    const intent: FundingIntent = {
      providerRef: nextId('pi'),
      clientSecret: nextId('secret'),
      amountCents: params.amountCents,
      currency: params.currency,
      status: 'requires_payment',
    };
    this.byKey.set(params.idempotencyKey, intent);
    return intent;
  }
}

export interface PaymentProviderEnv {
  PAYMENTS_PROVIDER?: 'mock' | 'stripe';
  REAL_MONEY_ENABLED: boolean;
  STRIPE_SECRET_KEY?: string;
}

/**
 * Wählt den Zahlungsanbieter. `stripe` (auch im Testmodus) erfordert einen
 * Secret-Key. Der Mock kann kein echtes Geld bewegen — ist Echtgeld aktiviert, ohne
 * dass ein echter Provider gewählt ist, wirft die Factory hart.
 */
export function createPaymentProvider(env: PaymentProviderEnv): PaymentProvider {
  if (env.PAYMENTS_PROVIDER === 'stripe') {
    if (!env.STRIPE_SECRET_KEY) {
      throw new Error('PAYMENTS_PROVIDER=stripe erfordert STRIPE_SECRET_KEY.');
    }
    return new StripePaymentProvider(env.STRIPE_SECRET_KEY);
  }
  if (env.REAL_MONEY_ENABLED) {
    throw new Error('REAL_MONEY_ENABLED=true, aber kein Live-Zahlungsanbieter gewählt (PAYMENTS_PROVIDER=stripe).');
  }
  return new MockPaymentProvider();
}

export interface WebhookVerifierEnv {
  PAYMENTS_PROVIDER?: 'mock' | 'stripe';
  WEBHOOK_SECRET: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
}

/** Wählt den Webhook-Verifier passend zum Zahlungsanbieter. */
export function createWebhookVerifier(env: WebhookVerifierEnv): WebhookVerifier {
  if (env.PAYMENTS_PROVIDER === 'stripe') {
    if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
      throw new Error('PAYMENTS_PROVIDER=stripe erfordert STRIPE_SECRET_KEY und STRIPE_WEBHOOK_SECRET.');
    }
    return new StripeWebhookVerifier(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET);
  }
  return new MockWebhookVerifier(env.WEBHOOK_SECRET);
}

export { StripePaymentProvider, StripeWebhookVerifier };
export { MockWebhookVerifier };
export type { WebhookVerifier };
export type { WebhookHeaders, NormalizedFundingEvent } from './webhook-verifier.js';
