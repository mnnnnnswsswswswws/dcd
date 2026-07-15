import { Global, Module } from '@nestjs/common';
import { AuthGuard } from './auth.guard.js';
import { MockTokenVerifier, TOKEN_VERIFIER } from './token-verifier.js';

/**
 * Bindet den TokenVerifier. Default ist der MockTokenVerifier (kein Netzwerk);
 * in Produktion wird hier der FirebaseTokenVerifier eingehängt.
 */
@Global()
@Module({
  providers: [{ provide: TOKEN_VERIFIER, useClass: MockTokenVerifier }, AuthGuard],
  exports: [TOKEN_VERIFIER, AuthGuard],
})
export class AuthModule {}
