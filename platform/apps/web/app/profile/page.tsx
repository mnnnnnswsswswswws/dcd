'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  API_BASE_IS_FIXED,
  api,
  clearToken,
  emitSession,
  getConfig,
  register,
  setApiBase,
  subscribeSession,
  type MyProfile,
} from '../../lib/api';

export default function ProfilePage() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [tokenShort, setTokenShort] = useState('');
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [adult, setAdult] = useState(false);
  const [apiBase, setApiBaseState] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const cfg = getConfig();
    const hasToken = Boolean(cfg.token);
    setLoggedIn(hasToken);
    setTokenShort(cfg.token.slice(0, 8));
    setApiBaseState(cfg.apiBase);
    if (!hasToken) {
      setProfile(null);
      return;
    }
    try {
      const me = await api<MyProfile>('/v1/users/me');
      setProfile(me);
      setUsername(me.username ?? '');
      setDisplayName(me.displayName ?? '');
      setBio(me.bio ?? '');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    return subscribeSession(load);
  }, [load]);

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

  async function save() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const body: Record<string, string> = {};
      if (username.trim()) body.username = username.trim();
      if (displayName.trim()) body.displayName = displayName.trim();
      if (bio.trim()) body.bio = bio.trim();
      await api('/v1/users/me', { method: 'PATCH', body });
      setNote('Profil gespeichert ✓');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Profil</h1>
      {error && <p className="error">Fehler: {error}</p>}
      {note && <p className="note">{note}</p>}

      {/* Session */}
      <div className="card stack">
        {loggedIn ? (
          <div className="row between">
            <span className="muted">Angemeldet · {tokenShort}…</span>
            <button className="ghost sm" onClick={logout}>
              Abmelden
            </button>
          </div>
        ) : (
          <>
            <strong>Anmelden</strong>
            <p className="muted" style={{ margin: 0, fontSize: '0.88rem' }}>
              Die Plattform ist ausschließlich für Personen ab 18 Jahren.
            </p>
            <label className="row" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, color: 'inherit' }}>
              <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} style={{ width: 'auto' }} /> Ich bin 18+
            </label>
            <button className="primary" onClick={doRegister} disabled={!adult || busy}>
              {busy ? 'Registriere…' : 'Registrieren & anmelden'}
            </button>
          </>
        )}
        {!API_BASE_IS_FIXED && (
          <label style={{ marginTop: 4 }}>
            API-Basis-URL (nur zum Testen)
            <input value={apiBase} onChange={(e) => saveApiBase(e.target.value)} placeholder="http://localhost:8080" />
          </label>
        )}
      </div>

      {loggedIn && profile && (
        <div className="card stack">
          <strong>Öffentliches Profil</strong>
          <label>
            Nutzername (a–z 0–9 _)
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="z. B. acemaker" maxLength={20} />
          </label>
          <label>
            Anzeigename
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="z. B. Ace" maxLength={40} />
          </label>
          <label>
            Bio
            <textarea value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Kurz über dich." maxLength={200} />
          </label>
          <button className="primary" onClick={save} disabled={busy}>
            {busy ? 'Speichere…' : 'Speichern'}
          </button>
          <Link href="/me" className="muted" style={{ fontSize: '0.88rem' }}>
            Meine Challenges →
          </Link>
          {profile.username && (
            <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>
              Öffentlich: <Link href={`/u/${profile.username}`}>/u/{profile.username}</Link>
            </p>
          )}
        </div>
      )}
    </>
  );
}
