'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, getToken, subscribeSession, type MyProfile } from '../../lib/api';

export default function ProfilePage() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const hasToken = Boolean(getToken());
    setLoggedIn(hasToken);
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
      <p>
        <Link href="/">← Alle Challenges</Link>
      </p>
      <h1>Profil</h1>

      {!loggedIn && <div className="note">Bitte oben rechts registrieren/anmelden.</div>}
      {error && <p className="error">Fehler: {error}</p>}
      {note && <p className="note">{note}</p>}

      {loggedIn && profile && (
        <div className="card stack" style={{ maxWidth: 460 }}>
          <label>
            Nutzername (öffentlich, a–z 0–9 _)
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
          {profile.username && (
            <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>
              Dein öffentliches Profil: <Link href={`/u/${profile.username}`}>/u/{profile.username}</Link>
            </p>
          )}
        </div>
      )}
    </>
  );
}
