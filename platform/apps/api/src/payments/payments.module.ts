import { Global, Module } from '@nestjs/common';
import { createPaymentProvider, createWebhookVerifier } from '@vcp/payments';
import { loadEnv } from '@vcp/config';

/** DI-Token für den PaymentProvider bzw. den Webhook-Verifier. */
export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
export const WEBHOOK_VERIFIER = Symbol('WEBHOOK_VERIFIER');

@Global()
@Module({
  providers: [
    {
      provide: PAYMENT_PROVIDER,
      // Factory wirft hart, wenn Echtgeld ohne Live-Provider aktiviert ist.
      useFactory: () => {
        const env = loadEnv();
        return createPaymentProvider({
          PAYMENTS_PROVIDER: env.PAYMENTS_PROVIDER,
          REAL_MONEY_ENABLED: env.REAL_MONEY_ENABLED,
          STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY,
        });
      },
    },
    {
      provide: WEBHOOK_VERIFIER,
      useFactory: () => {
        const env = loadEnv();
        return createWebhookVerifier({
          PAYMENTS_PROVIDER: env.PAYMENTS_PROVIDER,
          WEBHOOK_SECRET: env.WEBHOOK_SECRET,
          STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY,
          STRIPE_WEBHOOK_SECRET: env.STRIPE_WEBHOOK_SECRET,
        });
      },
    },
  ],
  exports: [PAYMENT_PROVIDER, WEBHOOK_VERIFIER],
})
export class PaymentsModule {}
