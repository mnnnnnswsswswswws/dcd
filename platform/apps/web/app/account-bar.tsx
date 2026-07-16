'use client';

import { useEffect, useState } from 'react';
import { clearToken, getConfig, register, setApiBase } from '../lib/api';

/**
 * Konto-Leiste: API-Basis-URL, Registrierung (18+-Gate) und Abmelden. Die von der
 * Registrierung zurückgegebene ID dient im Mock-Auth-Setup als Bearer-Token.
 */
export function AccountBar({ onChange }: { onChange?: () => void }) {
  const [apiBase, setApiBaseState] = useState('');
  const [token, setTokenState] = useState('');
  const [adult, setAdult] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const c = getConfig();
    setApiBaseState(c.apiBase);
    setTokenState(c.token);
  }, []);

  function saveApiBase(v: string) {
    setApiBaseState(v);
    setApiBase(v);
    onChange?.();
  }

  async function doRegister() {
    setBusy(true);
    setError(null);
    try {
      const id = await register();
      setTokenState(id);
      onChange?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    clearToken();
    setTokenState('');
    onChange?.();
  }

  return (
    <div className="bar">
      <label style={{ flex: '1 1 240px' }}>
        API-Basis-URL
        <input value={apiBase} onChange={(e) => saveApiBase(e.target.value)} placeholder="http://localhost:8080" />
      </label>

      {token ? (
        <div className="row">
          <span className="muted">Angemeldet als {token.slice(0, 8)}…</span>
          <button onClick={logout}>Abmelden</button>
        </div>
      ) : (
        <div className="row">
          <label className="row" style={{ flexDirection: 'row', alignItems: 'center', color: 'inherit' }}>
            <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} /> Ich bin 18+
          </label>
          <button className="primary" onClick={doRegister} disabled={!adult || busy}>
            {busy ? 'Registriere…' : 'Registrieren & anmelden'}
          </button>
        </div>
      )}
      {error && <span className="error">{error}</span>}
    </div>
  );
}
