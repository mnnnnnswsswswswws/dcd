/**
 * Zahlungs-Abstraktion.
 *
 * Geld fließt ausschließlich über idempotente Backend-Prozesse. Der `PaymentProvider`
 * kapselt die Erstellung einer Finanzierungs-Absicht (Escrow der Preissumme). Im MVP
 * gibt es nur den `MockPaymentProvider`; ein echter Provider (Stripe Connect) wird
 * erst nach ausdrücklicher Flag-Freigabe angebunden. Beträge ausschließlich in Cent.
 */
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
  REAL_MONEY_ENABLED: boolean;
}

/**
 * Wählt den Provider. Ist Echtgeld aktiviert, existiert (noch) kein Live-Provider —
 * die Factory wirft dann hart, damit niemals versehentlich echtes Geld bewegt wird.
 */
export function createPaymentProvider(env: PaymentProviderEnv): PaymentProvider {
  if (env.REAL_MONEY_ENABLED) {
    throw new Error(
      'REAL_MONEY_ENABLED=true, aber es ist kein Live-Zahlungsanbieter angebunden.',
    );
  }
  return new MockPaymentProvider();
}
