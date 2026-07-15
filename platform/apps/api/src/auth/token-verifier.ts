/**
 * Token-Verifikation als austauschbarer Kontrakt.
 *
 * Produktiv steht hier `FirebaseTokenVerifier` (lazy firebase-admin Init); für
 * lokale Entwicklung und Tests genügt `MockTokenVerifier`, der das Bearer-Token
 * direkt als User-ID interpretiert. Kein Netzwerk, keine Credentials nötig.
 */
export interface VerifiedToken {
  userId: string;
}

export interface TokenVerifier {
  verify(token: string): Promise<VerifiedToken>;
}

/** DI-Token (Interface hat keine Laufzeitrepräsentation). */
export const TOKEN_VERIFIER = Symbol('TOKEN_VERIFIER');

export class MockTokenVerifier implements TokenVerifier {
  async verify(token: string): Promise<VerifiedToken> {
    const userId = token.trim();
    if (userId.length === 0) {
      throw new Error('Leeres Token');
    }
    return { userId };
  }
}
