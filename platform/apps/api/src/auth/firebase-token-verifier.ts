import type { Auth } from 'firebase-admin/auth';
import type { TokenVerifier, VerifiedToken } from './token-verifier.js';

/**
 * Echter Token-Verifier auf Basis von Firebase Auth. `firebase-admin` wird lazy
 * importiert und initialisiert (Application Default Credentials via
 * `GOOGLE_APPLICATION_CREDENTIALS`), damit Mock-Betrieb und Tests ohne Firebase-
 * Credentials laufen. Admin-Rechte werden über den Custom-Claim `admin` gelesen.
 */
export class FirebaseTokenVerifier implements TokenVerifier {
  private authInstance: Auth | undefined;

  constructor(private readonly projectId: string) {}

  private async auth(): Promise<Auth> {
    if (this.authInstance === undefined) {
      const { initializeApp, getApps } = await import('firebase-admin/app');
      const { getAuth } = await import('firebase-admin/auth');
      const app = getApps().length > 0 ? getApps()[0]! : initializeApp({ projectId: this.projectId });
      this.authInstance = getAuth(app);
    }
    return this.authInstance;
  }

  async verify(token: string): Promise<VerifiedToken> {
    const auth = await this.auth();
    const decoded = await auth.verifyIdToken(token);
    return { userId: decoded.uid, isAdmin: decoded.admin === true };
  }
}
