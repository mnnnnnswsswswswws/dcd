import { describe, expect, it } from 'vitest';
import { createTokenVerifier } from './create-token-verifier.js';
import { MockTokenVerifier } from './token-verifier.js';
import { FirebaseTokenVerifier } from './firebase-token-verifier.js';

describe('createTokenVerifier', () => {
  it('liefert den Mock-Verifier im Default', () => {
    expect(createTokenVerifier({})).toBeInstanceOf(MockTokenVerifier);
  });

  it('liefert den Firebase-Verifier bei AUTH_PROVIDER=firebase mit Projekt-ID', () => {
    const v = createTokenVerifier({ AUTH_PROVIDER: 'firebase', FIREBASE_PROJECT_ID: 'demo' });
    expect(v).toBeInstanceOf(FirebaseTokenVerifier);
  });

  it('wirft, wenn firebase gewählt aber keine Projekt-ID gesetzt ist', () => {
    expect(() => createTokenVerifier({ AUTH_PROVIDER: 'firebase' })).toThrow();
  });
});
