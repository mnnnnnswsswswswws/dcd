import { type AppCheckVerifier, MockAppCheckVerifier } from './app-check-verifier.js';
import { FirebaseAppCheckVerifier } from './firebase-app-check-verifier.js';

export interface AppCheckVerifierEnv {
  AUTH_PROVIDER?: 'mock' | 'firebase';
  FIREBASE_PROJECT_ID?: string;
}

/**
 * Wählt den App-Check-Verifier. Default ist der Mock (kein Netzwerk); mit
 * `AUTH_PROVIDER=firebase` der echte Firebase-Verifier (braucht Projekt-ID).
 */
export function createAppCheckVerifier(env: AppCheckVerifierEnv): AppCheckVerifier {
  if (env.AUTH_PROVIDER === 'firebase') {
    if (!env.FIREBASE_PROJECT_ID) {
      throw new Error('AUTH_PROVIDER=firebase erfordert FIREBASE_PROJECT_ID.');
    }
    return new FirebaseAppCheckVerifier(env.FIREBASE_PROJECT_ID);
  }
  return new MockAppCheckVerifier();
}
