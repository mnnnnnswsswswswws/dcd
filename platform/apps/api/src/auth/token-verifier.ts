/**
 * Token-Verifikation als austauschbarer Kontrakt.
 *
 * Produktiv steht hier `FirebaseTokenVerifier` (lazy firebase-admin Init); für
 * lokale Entwicklung und Tests genügt `MockTokenVerifier`, der das Bearer-Token
 * direkt als User-ID interpretiert. Kein Netzwerk, keine Credentials nötig.
 */
export interface VerifiedToken {
  userId: string;
  isAdmin: boolean;
}

export interface TokenVerifier {
  verify(token: string): Promise<VerifiedToken>;
}

/** DI-Token (Interface hat keine Laufzeitrepräsentation). */
export const TOKEN_VERIFIER = Symbol('TOKEN_VERIFIER');

/**
 * Interpretiert das Bearer-Token als User-ID. Präfix `admin:` markiert einen Admin
 * (z. B. `admin:<uuid>`) — nur für Entwicklung/Tests, ersetzt später Firebase-Claims.
 */
export class MockTokenVerifier implements TokenVerifier {
  async verify(token: string): Promise<VerifiedToken> {
    const trimmed = token.trim();
    if (trimmed.length === 0) {
      throw new Error('Leeres Token');
    }
    if (trimmed.startsWith('admin:')) {
      const userId = trimmed.slice('admin:'.length);
      if (userId.length === 0) {
        throw new Error('Leere Admin-User-ID');
      }
      return { userId, isAdmin: true };
    }
    return { userId: trimmed, isAdmin: false };
  }
}
