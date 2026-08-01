import { Global, Module } from '@nestjs/common';
import { loadEnv } from '@vcp/config';
import { AuthGuard } from './auth.guard.js';
import { TOKEN_VERIFIER } from './token-verifier.js';
import { createTokenVerifier } from './create-token-verifier.js';

/**
 * Bindet den TokenVerifier über die Env-basierte Auswahl. Default ist der
 * MockTokenVerifier (kein Netzwerk); mit `AUTH_PROVIDER=firebase` der echte
 * FirebaseTokenVerifier.
 */
@Global()
@Module({
  providers: [
    {
      provide: TOKEN_VERIFIER,
      useFactory: () => {
        const env = loadEnv();
        return createTokenVerifier({
          AUTH_PROVIDER: env.AUTH_PROVIDER,
          FIREBASE_PROJECT_ID: env.FIREBASE_PROJECT_ID,
        });
      },
    },
    AuthGuard,
  ],
  exports: [TOKEN_VERIFIER, AuthGuard],
})
export class AuthModule {}
