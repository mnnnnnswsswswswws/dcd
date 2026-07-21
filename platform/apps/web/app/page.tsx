'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  api,
  euro,
  selectionModeLabel,
  statusLabel,
  statusTone,
  subscribeSession,
  type ChallengeSummary,
  type FeedEntry,
} from '../lib/api';

export default function HomePage() {
  const [open, setOpen] = useState<ChallengeSummary[]>([]);
  const [feed, setFeed] = useState<FeedEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError(null);
    try {
      setOpen(await api<ChallengeSummary[]>('/v1/challenges?status=OPEN', { auth: false }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
    // Feed ist optional (Flag PUBLIC_FEED_ENABLED) — 404 ruhig behandeln.
    try {
      setFeed(await api<FeedEntry[]>('/v1/feed', { auth: false }));
    } catch {
      setFeed(null);
    }
  }, []);

  useEffect(() => {
    void load();
    return subscribeSession(load);
  }, [load]);

  return (
    <>
      <section className="hero">
        <h1>Zeig, was du kannst.</h1>
        <p>
          Tritt bezahlten Video-Challenges bei, reiche deinen Beweis in der App ein und gewinne das
          Preisgeld. Max. 10 Plätze pro Challenge — schnell sein lohnt sich.
        </p>
        <div className="row" style={{ marginTop: 12 }}>
          <Link href="/create" className="badge open" style={{ padding: '8px 14px' }}>
            + Eigene Challenge erstellen
          </Link>
        </div>
      </section>

      {error && <p className="error">Fehler: {error}</p>}

      <h2>Offene Challenges</h2>
      {loading && <p className="muted">Lädt…</p>}
      <div className="grid">
        {open.map((c) => (
          <Link key={c.id} href={`/challenges/${c.id}`} className="card tap">
            <div className="row between">
              <strong style={{ fontSize: '1.05rem' }}>{c.title || 'Ohne Titel'}</strong>
              <span className="prize">{euro(c.prizeAmountCents)}</span>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <span className={`badge ${statusTone(c.status)}`}>{statusLabel(c.status)}</span>
              {c.category && <span className="badge">{c.category}</span>}
              <span className="badge">{selectionModeLabel(c.selectionMode)}</span>
            </div>
            <div className="muted" style={{ marginTop: 8, fontSize: '0.85rem' }}>
              Einsendeschluss:{' '}
              {c.submissionDeadline ? new Date(c.submissionDeadline).toLocaleString('de-DE') : '—'}
            </div>
          </Link>
        ))}
        {!loading && open.length === 0 && (
          <div className="card">
            <p className="muted" style={{ margin: 0 }}>
              Derzeit keine offenen Challenges. Sei die/der Erste und{' '}
              <Link href="/create">erstelle eine</Link>.
            </p>
          </div>
        )}
      </div>

      {feed && feed.length > 0 && (
        <>
          <h2>Entschieden</h2>
          <div className="grid">
            {feed.map((f) => (
              <div key={f.id} className="card">
                <div className="row between">
                  <span className={`badge ${statusTone(f.status)}`}>{statusLabel(f.status)}</span>
                  <span className="prize">{euro(f.prizeAmountCents)}</span>
                </div>
                <div className="muted" style={{ marginTop: 6, fontSize: '0.85rem' }}>
                  Gewinner ermittelt · {selectionModeLabel(f.selectionMode)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
