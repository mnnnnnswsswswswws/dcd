import { Global, Module } from '@nestjs/common';
import { createPaymentProvider } from '@vcp/payments';
import { loadEnv } from '@vcp/config';

/** DI-Token für den PaymentProvider. */
export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

@Global()
@Module({
  providers: [
    {
      provide: PAYMENT_PROVIDER,
      // Factory wirft hart, wenn Echtgeld aktiviert ist (kein Live-Provider).
      useFactory: () => createPaymentProvider({ REAL_MONEY_ENABLED: loadEnv().REAL_MONEY_ENABLED }),
    },
  ],
  exports: [PAYMENT_PROVIDER],
})
export class PaymentsModule {}
