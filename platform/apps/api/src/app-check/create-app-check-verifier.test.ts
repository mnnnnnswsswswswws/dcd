import { describe, expect, it } from 'vitest';
import { MockAppCheckVerifier } from './app-check-verifier.js';
import { createAppCheckVerifier } from './create-app-check-verifier.js';

describe('createAppCheckVerifier', () => {
  it('liefert per Default den Mock', () => {
    expect(createAppCheckVerifier({}).kind).toBe('mock');
    expect(createAppCheckVerifier({ AUTH_PROVIDER: 'mock' }).kind).toBe('mock');
  });

  it('firebase ohne Projekt-ID wirft', () => {
    expect(() => createAppCheckVerifier({ AUTH_PROVIDER: 'firebase' })).toThrow();
  });

  it('firebase mit Projekt-ID liefert den Firebase-Verifier', () => {
    expect(createAppCheckVerifier({ AUTH_PROVIDER: 'firebase', FIREBASE_PROJECT_ID: 'p' }).kind).toBe('firebase');
  });
});

describe('MockAppCheckVerifier', () => {
  it('akzeptiert nicht-leere Token, lehnt leere ab', async () => {
    const v = new MockAppCheckVerifier();
    await expect(v.verify('some-token')).resolves.toBeUndefined();
    await expect(v.verify('')).rejects.toThrow();
    await expect(v.verify('   ')).rejects.toThrow();
  });
});
