'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, euro, type ChallengeSummary, type FeedEntry } from '../lib/api';
import { AccountBar } from './account-bar';

export default function HomePage() {
  const [open, setOpen] = useState<ChallengeSummary[]>([]);
  const [feed, setFeed] = useState<FeedEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setOpen(await api<ChallengeSummary[]>('/v1/challenges?status=OPEN', { auth: false }));
    } catch (e) {
      setError((e as Error).message);
    }
    // Feed ist optional (Flag) — 404 ruhig behandeln.
    try {
      setFeed(await api<FeedEntry[]>('/v1/feed', { auth: false }));
    } catch {
      setFeed(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <h1>Video-Challenges</h1>
      <AccountBar onChange={load} />

      {error && <p className="error">Fehler: {error}</p>}

      <p className="row">
        <Link href="/create">+ Eigene Challenge erstellen</Link>
        <Link href="/me">Meine Challenges</Link>
      </p>

      <h2 style={{ fontSize: '1.15rem' }}>Offene Challenges</h2>
      <div className="grid">
        {open.map((c) => (
          <Link key={c.id} href={`/challenges/${c.id}`} className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{c.title || 'Ohne Titel'}</strong>
              <strong>{euro(c.prizeAmountCents)}</strong>
            </div>
            <div className="muted">
              <span className="badge">{c.status}</span> {c.category ? `· ${c.category} ` : ''}· {c.selectionMode}
              {' · Frist '}
              {c.submissionDeadline ? new Date(c.submissionDeadline).toLocaleString('de-DE') : '—'}
            </div>
          </Link>
        ))}
        {open.length === 0 && <p className="muted">Derzeit keine offenen Challenges.</p>}
      </div>

      {feed && feed.length > 0 && (
        <>
          <h2 style={{ fontSize: '1.15rem', marginTop: 28 }}>Entschieden (Feed)</h2>
          <div className="grid">
            {feed.map((f) => (
              <div key={f.id} className="card">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="badge">{f.status}</span>
                  <strong>{euro(f.prizeAmountCents)}</strong>
                </div>
                <div className="muted">Gewinner via {f.winner?.decisionSource ?? '—'}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
