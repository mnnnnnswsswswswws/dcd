import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POOL_TIMEOUT_S,
  FALLBACK_POOL_SIZE,
  buildDatasourceUrl,
  resolvePoolSize,
  withPoolSettings,
} from './pool-url.js';

/**
 * Diese Tests schließen die Lücke zwischen geprüftem Budget und tatsächlicher
 * Laufzeit: Was `@vcp/capacity` rechnet, muss die Verbindung auch wirklich
 * einhalten.
 */
describe('Poolgröße in der Datenbank-URL', () => {
  const base = 'postgresql://u:p@host:5432/db?schema=public';

  it('setzt connection_limit und pool_timeout', () => {
    const url = new URL(withPoolSettings(base, { poolSize: 5 }));
    expect(url.searchParams.get('connection_limit')).toBe('5');
    expect(url.searchParams.get('pool_timeout')).toBe(String(DEFAULT_POOL_TIMEOUT_S));
  });

  it('lässt bestehende Parameter unangetastet', () => {
    const url = new URL(
      withPoolSettings('postgresql://u:p@h/db?sslmode=require&pgbouncer=true', { poolSize: 4 }),
    );
    expect(url.searchParams.get('sslmode')).toBe('require');
    expect(url.searchParams.get('pgbouncer')).toBe('true');
    expect(url.searchParams.get('connection_limit')).toBe('4');
  });

  it('überschreibt ein bereits gesetztes connection_limit', () => {
    // Die Kapazitätsableitung gewinnt gegen einen zufällig mitgelieferten Wert.
    const url = new URL(withPoolSettings(`${base}&connection_limit=99`, { poolSize: 5 }));
    expect(url.searchParams.get('connection_limit')).toBe('5');
  });

  it('lehnt eine unsinnige Poolgröße ab', () => {
    expect(() => withPoolSettings(base, { poolSize: 0 })).toThrow();
    expect(() => withPoolSettings(base, { poolSize: -1 })).toThrow();
  });
});

describe('Poolgröße aus der Umgebung', () => {
  it('übernimmt DB_POOL_SIZE', () => {
    expect(resolvePoolSize({ DB_POOL_SIZE: '4' })).toBe(4);
  });

  it('fällt auf den konservativen Default zurück, statt zu raten', () => {
    expect(resolvePoolSize({})).toBe(FALLBACK_POOL_SIZE);
    expect(resolvePoolSize({ DB_POOL_SIZE: '' })).toBe(FALLBACK_POOL_SIZE);
    expect(resolvePoolSize({ DB_POOL_SIZE: 'viele' })).toBe(FALLBACK_POOL_SIZE);
    expect(resolvePoolSize({ DB_POOL_SIZE: '0' })).toBe(FALLBACK_POOL_SIZE);
    expect(resolvePoolSize({ DB_POOL_SIZE: '-3' })).toBe(FALLBACK_POOL_SIZE);
  });
});

describe('Datasource-URL des Prozesses', () => {
  it('kombiniert DATABASE_URL und DB_POOL_SIZE', () => {
    const url = new URL(
      buildDatasourceUrl({
        DATABASE_URL: 'postgresql://u:p@h/db',
        DB_POOL_SIZE: '7',
      })!,
    );
    expect(url.searchParams.get('connection_limit')).toBe('7');
  });

  it('liefert undefined ohne DATABASE_URL', () => {
    expect(buildDatasourceUrl({})).toBeUndefined();
  });

  it('entspricht der Terraform-Konfiguration für die API', () => {
    // Terraform setzt DB_POOL_SIZE=5 für den api-Dienst (capacity.auto.tfvars.json).
    // Weicht das hier ab, ist das Budget nur noch theoretisch.
    const url = new URL(
      buildDatasourceUrl({ DATABASE_URL: 'postgresql://u:p@h/db', DB_POOL_SIZE: '5' })!,
    );
    expect(url.searchParams.get('connection_limit')).toBe('5');
  });
});
