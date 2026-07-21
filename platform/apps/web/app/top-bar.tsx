'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  API_BASE_IS_FIXED,
  clearToken,
  emitSession,
  getConfig,
  register,
  setApiBase,
  subscribeSession,
} from '../lib/api';

/**
 * Globale Kopfleiste: Marke, Navigation und Session. Die Registrierung (18+-Gate)
 * liefert eine ID, die im Mock-Auth-Setup als Bearer-Token dient. Die API-Basis wird
 * für den Launch per `NEXT_PUBLIC_API_BASE` gesetzt; nur ohne feste Vorgabe erscheint
 * das Verbindungsfeld zum manuellen Testen.
 */
export function TopBar() {
  const pathname = usePathname();
  const [token, setToken] = useState('');
  const [apiBase, setApiBaseState] = useState('');
  const [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    const sync = () => {
      const c = getConfig();
      setToken(c.token);
      setApiBaseState(c.apiBase);
    };
    sync();
    return subscribeSession(sync);
  }, []);

  async function doRegister() {
    setBusy(true);
    setError(null);
    try {
      await register();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    clearToken();
    emitSession();
  }

  function saveApiBase(v: string) {
    setApiBaseState(v);
    setApiBase(v);
    emitSession();
  }

  const nav = [
    { href: '/', label: 'Entdecken' },
    { href: '/create', label: 'Erstellen' },
    { href: '/me', label: 'Meine' },
  ];

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link href="/" className="brand">
          <span className="dot" /> Video-Challenges
        </Link>
        <nav>
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`navlink${pathname === n.href ? ' active' : ''}`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="topbar-inner" style={{ paddingTop: 0 }}>
        <div className="session" style={{ marginLeft: 'auto' }}>
          {token ? (
            <>
              <span className="badge" title={token}>
                {token.startsWith('admin:') ? 'Admin' : `Angemeldet · ${token.slice(0, 6)}…`}
              </span>
              <button className="ghost sm" onClick={logout}>
                Abmelden
              </button>
            </>
          ) : (
            <>
              <label className="row" style={{ flexDirection: 'row', alignItems: 'center', fontSize: '0.85rem' }}>
                <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} /> 18+
              </label>
              <button className="primary sm" onClick={doRegister} disabled={!adult || busy}>
                {busy ? 'Anmelden…' : 'Registrieren'}
              </button>
            </>
          )}
          {!API_BASE_IS_FIXED && (
            <button className="ghost sm" onClick={() => setShowSettings((s) => !s)} title="Verbindung">
              ⚙
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="settings-panel">
          <span className="error">{error}</span>
        </div>
      )}

      {showSettings && !API_BASE_IS_FIXED && (
        <div className="settings-panel">
          <div className="settings-card">
            <label>
              API-Basis-URL (nur zum Testen)
              <input value={apiBase} onChange={(e) => saveApiBase(e.target.value)} placeholder="http://localhost:8080" />
            </label>
          </div>
        </div>
      )}
    </header>
  );
}
