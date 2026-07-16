'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, euro, getConfig, type ChallengeSummary } from '../../lib/api';
import { AccountBar } from '../account-bar';

interface JoinedChallenge extends ChallengeSummary {
  slotStatus: string;
}

interface MyChallenges {
  created: ChallengeSummary[];
  joined: JoinedChallenge[];
}

function List({ items }: { items: (ChallengeSummary & { slotStatus?: string })[] }) {
  if (items.length === 0) return <p className="muted">Keine.</p>;
  return (
    <div className="grid">
      {items.map((c) => (
        <Link key={c.id} href={`/challenges/${c.id}`} className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="badge">{c.status}</span>
            <strong>{euro(c.prizeAmountCents)}</strong>
          </div>
          <div className="muted">
            {c.selectionMode}
            {c.slotStatus ? ` · dein Slot: ${c.slotStatus}` : ''}
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
    const hasToken = Boolean(getConfig().token);
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
  }, [load]);

  return (
    <>
      <p>
        <Link href="/">← Alle Challenges</Link>
      </p>
      <h1>Meine Challenges</h1>
      <AccountBar onChange={load} />

      {!loggedIn && <p className="muted">Bitte oben registrieren/anmelden.</p>}
      {error && <p className="error">Fehler: {error}</p>}

      {data && (
        <>
          <h2 style={{ fontSize: '1.15rem' }}>Erstellt</h2>
          <List items={data.created} />
          <h2 style={{ fontSize: '1.15rem', marginTop: 24 }}>Beigetreten</h2>
          <List items={data.joined} />
        </>
      )}
    </>
  );
}
