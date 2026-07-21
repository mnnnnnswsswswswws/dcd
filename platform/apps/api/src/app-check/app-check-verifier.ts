/**
 * Verifiziert einen App-Check-Token (Nachweis, dass der Request von einer echten,
 * nicht manipulierten App-Instanz stammt). `verify` wirft bei Ungültigkeit.
 */
export interface AppCheckVerifier {
  readonly kind: 'mock' | 'firebase';
  verify(token: string): Promise<void>;
}

/**
 * Mock-Verifier für Entwicklung/Tests: akzeptiert jeden nicht-leeren Token und lehnt
 * einen leeren ab. Kein Netzwerk, keine Credentials.
 */
export class MockAppCheckVerifier implements AppCheckVerifier {
  readonly kind = 'mock' as const;

  async verify(token: string): Promise<void> {
    if (!token || token.trim().length === 0) {
      throw new Error('App-Check-Token fehlt.');
    }
  }
}
