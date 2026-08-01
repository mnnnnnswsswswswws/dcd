/**
 * Verifikation eingehender Zahlungs-Webhooks, provider-agnostisch.
 *
 * Der Mock prüft ein gemeinsames Secret im Header (Entwicklung/Tests); der echte
 * Stripe-Verifier prüft die Signatur über den Raw-Body. Beide liefern ein
 * normalisiertes Funding-Event zurück oder werfen.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
export interface NormalizedFundingEvent {
  type: 'funding.succeeded';
  providerRef: string;
  amountCents: number;
}

export type WebhookHeaders = Record<string, string | string[] | undefined>;

export interface WebhookVerifier {
  verify(rawBody: Buffer | string, headers: WebhookHeaders): Promise<NormalizedFundingEvent>;
}

function headerValue(headers: WebhookHeaders, name: string): string | undefined {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(raw) ? raw[0] : raw;
}

/** Konstantzeit-Vergleich (über SHA-256, damit auch die Länge nichts verrät). */
function secretsEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Prüft ein gemeinsames Secret im `x-webhook-secret`-Header und parst den JSON-Body. */
export class MockWebhookVerifier implements WebhookVerifier {
  constructor(private readonly secret: string) {}

  async verify(rawBody: Buffer | string, headers: WebhookHeaders): Promise<NormalizedFundingEvent> {
    const provided = headerValue(headers, 'x-webhook-secret');
    if (!provided || !secretsEqual(provided, this.secret)) {
      throw new Error('Ungültiges Webhook-Secret');
    }
    const body = JSON.parse(rawBody.toString());
    if (
      body?.type !== 'funding.succeeded' ||
      typeof body.providerRef !== 'string' ||
      typeof body.amountCents !== 'number' ||
      !Number.isSafeInteger(body.amountCents) ||
      body.amountCents <= 0
    ) {
      throw new Error('Ungültige Webhook-Nutzlast');
    }
    return { type: 'funding.succeeded', providerRef: body.providerRef, amountCents: body.amountCents };
  }
}
