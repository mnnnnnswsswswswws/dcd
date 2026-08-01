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
} from '../../lib/api';

export default function EntdeckenPage() {
  const [open, setOpen] = useState<ChallengeSummary[]>([]);
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
  }, []);

  useEffect(() => {
    void load();
    return subscribeSession(load);
  }, [load]);

  return (
    <>
      <h1>Entdecken</h1>
      {error && <p className="error">Fehler: {error}</p>}
      {loading && <p className="muted">Lädt…</p>}

      <div className="grid">
        {open.map((c) => (
          <Link key={c.id} href={`/challenges/${c.id}`} className="card tap">
            <div className="row between">
              <strong style={{ fontSize: '1.05rem' }}>{c.title || 'Ohne Titel'}</strong>
              <span className="prize">{euro(c.prizeAmountCents)}</span>
            </div>
            <div className="row">
              <span className={`badge ${statusTone(c.status)}`}>{statusLabel(c.status)}</span>
              {c.category && <span className="badge">{c.category}</span>}
              <span className="badge">{selectionModeLabel(c.selectionMode)}</span>
            </div>
            <div className="muted" style={{ fontSize: '0.85rem' }}>
              Einsendeschluss:{' '}
              {c.submissionDeadline ? new Date(c.submissionDeadline).toLocaleString('de-DE') : '—'}
            </div>
          </Link>
        ))}
        {!loading && open.length === 0 && (
          <div className="card">
            <p className="muted" style={{ margin: 0 }}>
              Derzeit keine offenen Challenges. Sei die/der Erste und <Link href="/create">erstelle eine</Link>.
            </p>
          </div>
        )}
      </div>
    </>
  );
}
