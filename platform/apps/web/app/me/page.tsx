'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  api,
  euro,
  getToken,
  selectionModeLabel,
  statusLabel,
  statusTone,
  subscribeSession,
  type ChallengeSummary,
  type MyChallenges,
} from '../../lib/api';

function CardList({ items }: { items: (ChallengeSummary & { slotStatus?: string })[] }) {
  if (items.length === 0) return <p className="muted">Keine.</p>;
  return (
    <div className="grid">
      {items.map((c) => (
        <Link key={`${c.id}-${c.slotStatus ?? 'own'}`} href={`/challenges/${c.id}`} className="card tap">
          <div className="row between">
            <strong>{c.title || 'Ohne Titel'}</strong>
            <span className="prize">{euro(c.prizeAmountCents)}</span>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <span className={`badge ${statusTone(c.status)}`}>{statusLabel(c.status)}</span>
            <span className="badge">{selectionModeLabel(c.selectionMode)}</span>
            {c.slotStatus && <span className="badge">dein Slot: {c.slotStatus}</span>}
          </div>
        </Link>
      ))}
    </div>
  );
}

export default function MyChallengesPage() {
  const [data, setData] = useState<MyChallenges | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const hasToken = Boolean(getToken());
    setLoggedIn(hasToken);
    if (!hasToken) {
      setData(null);
      return;
    }
    try {
      setData(await api<MyChallenges>('/v1/users/me/challenges'));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    return subscribeSession(load);
  }, [load]);

  return (
    <>
      <p>
        <Link href="/">← Alle Challenges</Link>
      </p>
      <h1>Meine Challenges</h1>

      {!loggedIn && <div className="note">Bitte oben rechts registrieren/anmelden.</div>}
      {error && <p className="error">Fehler: {error}</p>}

      {data && (
        <>
          <h2>Erstellt</h2>
          <CardList items={data.created} />
          <h2>Beigetreten</h2>
          <CardList items={data.joined} />
        </>
      )}
    </>
  );
}
