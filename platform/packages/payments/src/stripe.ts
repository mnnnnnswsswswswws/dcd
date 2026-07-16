import type StripeNs from 'stripe';
import type { CreateFundingIntentParams, FundingIntent, PaymentProvider } from './index.js';
import type { NormalizedFundingEvent, WebhookHeaders, WebhookVerifier } from './webhook-verifier.js';

/**
 * Echter Zahlungsanbieter auf Basis von Stripe (Test- oder Live-Modus über den
 * Secret-Key). `stripe` wird lazy importiert, damit Mock-Betrieb und Tests die
 * Bibliothek nicht laden und keine Credentials brauchen.
 */
export class StripePaymentProvider implements PaymentProvider {
  private client: StripeNs | undefined;

  constructor(private readonly secretKey: string) {}

  private async stripe(): Promise<StripeNs> {
    if (this.client === undefined) {
      const { default: Stripe } = await import('stripe');
      this.client = new Stripe(this.secretKey);
    }
    return this.client;
  }

  async createFundingIntent(params: CreateFundingIntentParams): Promise<FundingIntent> {
    const stripe = await this.stripe();
    const intent = await stripe.paymentIntents.create(
      {
        amount: params.amountCents,
        currency: params.currency,
        capture_method: 'automatic',
        metadata: params.metadata ?? {},
      },
      { idempotencyKey: params.idempotencyKey },
    );
    return {
      providerRef: intent.id,
      clientSecret: intent.client_secret ?? '',
      amountCents: intent.amount,
      currency: params.currency,
      status: intent.status === 'succeeded' ? 'succeeded' : 'requires_payment',
    };
  }
}

/** Verifiziert Stripe-Webhooks über die Signatur (`stripe-signature`) und Raw-Body. */
export class StripeWebhookVerifier implements WebhookVerifier {
  private client: StripeNs | undefined;

  constructor(
    private readonly secretKey: string,
    private readonly webhookSecret: string,
  ) {}

  private async stripe(): Promise<StripeNs> {
    if (this.client === undefined) {
      const { default: Stripe } = await import('stripe');
      this.client = new Stripe(this.secretKey);
    }
    return this.client;
  }

  async verify(rawBody: Buffer | string, headers: WebhookHeaders): Promise<NormalizedFundingEvent> {
    const stripe = await this.stripe();
    const sigRaw = headers['stripe-signature'];
    const signature = Array.isArray(sigRaw) ? sigRaw[0] : sigRaw;
    if (!signature) {
      throw new Error('Fehlende Stripe-Signatur');
    }
    const event = stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    if (event.type !== 'payment_intent.succeeded') {
      throw new Error(`Unerwarteter Event-Typ: ${event.type}`);
    }
    const intent = event.data.object as StripeNs.PaymentIntent;
    return { type: 'funding.succeeded', providerRef: intent.id, amountCents: intent.amount };
  }
}
