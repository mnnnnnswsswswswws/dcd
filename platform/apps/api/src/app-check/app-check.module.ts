import { Global, Module } from '@nestjs/common';
import { loadEnv } from '@vcp/config';
import { createAppCheckVerifier } from './create-app-check-verifier.js';

/** DI-Token für den App-Check-Verifier. */
export const APP_CHECK_VERIFIER = Symbol('APP_CHECK_VERIFIER');

/**
 * Bindet den App-Check-Verifier (Default Mock; `firebase` = echter Verifier). Global,
 * damit der App-Check-Guard ihn injizieren kann.
 */
@Global()
@Module({
  providers: [
    {
      provide: APP_CHECK_VERIFIER,
      useFactory: () => {
        const env = loadEnv();
        return createAppCheckVerifier({
          AUTH_PROVIDER: env.AUTH_PROVIDER,
          FIREBASE_PROJECT_ID: env.FIREBASE_PROJECT_ID,
        });
      },
    },
  ],
  exports: [APP_CHECK_VERIFIER],
})
export class AppCheckModule {}
