import type { AppCheckVerifier } from './app-check-verifier.js';

/**
 * Echter Firebase-App-Check-Verifier. Lädt `firebase-admin` **lazy** — Mock-Betrieb
 * und Tests brauchen das SDK nicht. Verifiziert den Token über `getAppCheck().verifyToken`.
 */
export class FirebaseAppCheckVerifier implements AppCheckVerifier {
  readonly kind = 'firebase' as const;
  private appCheckPromise: Promise<{ verifyToken(token: string): Promise<unknown> }> | null = null;

  constructor(private readonly projectId: string) {}

  private async getAppCheck() {
    if (this.appCheckPromise === null) {
      this.appCheckPromise = (async () => {
        const admin = await import('firebase-admin');
        if (admin.apps.length === 0) {
          admin.initializeApp({ projectId: this.projectId });
        }
        return admin.appCheck();
      })();
    }
    return this.appCheckPromise;
  }

  async verify(token: string): Promise<void> {
    const appCheck = await this.getAppCheck();
    await appCheck.verifyToken(token);
  }
}
