'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, emitSession, getToken, subscribeSession, type NotificationsResult } from '../../lib/api';

export default function NotificationsPage() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [data, setData] = useState<NotificationsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const hasToken = Boolean(getToken());
    setLoggedIn(hasToken);
    if (!hasToken) {
      setData(null);
      return;
    }
    try {
      setData(await api<NotificationsResult>('/v1/users/me/notifications'));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    return subscribeSession(load);
  }, [load]);

  async function markRead() {
    setBusy(true);
    try {
      await api('/v1/users/me/notifications/read', { method: 'POST' });
      await load();
      emitSession(); // aktualisiert den Ungelesen-Zähler in der Kopfleiste
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
      <div className="row between">
        <h1 style={{ margin: 0 }}>Mitteilungen</h1>
        {data && data.unreadCount > 0 && (
          <button className="ghost sm" onClick={markRead} disabled={busy}>
            Alle als gelesen
          </button>
        )}
      </div>

      {!loggedIn && <div className="note">Bitte oben rechts registrieren/anmelden.</div>}
      {error && <p className="error">Fehler: {error}</p>}

      {data && data.items.length === 0 && <p className="muted">Keine Mitteilungen.</p>}

      <div className="stack" style={{ marginTop: 12 }}>
        {data?.items.map((n) => {
          const inner = (
            <>
              <div className="row between">
                <strong>{n.title}</strong>
                {!n.read && <span className="badge open">neu</span>}
              </div>
              <div className="muted" style={{ fontSize: '0.9rem' }}>
                {n.body}
              </div>
              <div className="muted" style={{ fontSize: '0.78rem' }}>
                {new Date(n.createdAt).toLocaleString('de-DE')}
              </div>
            </>
          );
          return n.challengeId ? (
            <Link key={n.id} href={`/challenges/${n.challengeId}`} className="card tap">
              {inner}
            </Link>
          ) : (
            <div key={n.id} className="card">
              {inner}
            </div>
          );
        })}
      </div>
    </>
  );
}
