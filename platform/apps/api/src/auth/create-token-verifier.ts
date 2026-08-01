import { MockTokenVerifier, type TokenVerifier } from './token-verifier.js';
import { FirebaseTokenVerifier } from './firebase-token-verifier.js';

export interface TokenVerifierEnv {
  AUTH_PROVIDER?: 'mock' | 'firebase';
  FIREBASE_PROJECT_ID?: string;
}

/**
 * Wählt den Token-Verifier. Default ist der Mock (kein Netzwerk/Credentials);
 * `firebase` erfordert eine Projekt-ID und bindet den echten Firebase-Verifier.
 */
export function createTokenVerifier(env: TokenVerifierEnv): TokenVerifier {
  if (env.AUTH_PROVIDER === 'firebase') {
    if (!env.FIREBASE_PROJECT_ID) {
      throw new Error('AUTH_PROVIDER=firebase erfordert FIREBASE_PROJECT_ID.');
    }
    return new FirebaseTokenVerifier(env.FIREBASE_PROJECT_ID);
  }
  return new MockTokenVerifier();
}
