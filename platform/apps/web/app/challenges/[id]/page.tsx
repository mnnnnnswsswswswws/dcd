'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, euro, getConfig, type ChallengeDetail, type SubmissionRow } from '../../../lib/api';
import { AccountBar } from '../../account-bar';

export default function ChallengePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [challenge, setChallenge] = useState<ChallengeDetail | null>(null);
  const [subs, setSubs] = useState<SubmissionRow[]>([]);
  const [loggedIn, setLoggedIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const hasToken = Boolean(getConfig().token);
    setLoggedIn(hasToken);
    try {
      setChallenge(await api<ChallengeDetail>(`/v1/challenges/${id}`, { auth: false }));
    } catch (e) {
      setError((e as Error).message);
    }
    if (hasToken) {
      try {
        setSubs(await api<SubmissionRow[]>(`/v1/challenges/${id}/submissions`));
      } catch {
        setSubs([]);
      }
    } else {
      setSubs([]);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(label: string, run: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await run();
      setNote(`${label} ✓`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const isOpen = challenge?.status === 'OPEN' || challenge?.status === 'FULL';

  return (
    <>
      <p>
        <Link href="/">← Alle Challenges</Link>
      </p>
      <h1>Challenge</h1>
      <AccountBar onChange={load} />

      {error && <p className="error">Fehler: {error}</p>}
      {note && <p className="muted">{note}</p>}

      {challenge && (
        <>
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="badge">{challenge.status}</span>
              <strong>{euro(challenge.prizeAmountCents)}</strong>
            </div>
            <p className="muted">
              {challenge.selectionMode} · Plätze {challenge.occupiedSlots}/{challenge.maxSlots}
              {challenge.winner ? ` · Gewinner via ${challenge.winner.decisionSource}` : ''}
            </p>

            {loggedIn ? (
              <div className="row">
                <button className="primary" disabled={busy || !isOpen} onClick={() => act('Beigetreten', () => api(`/v1/challenges/${id}/join`, { method: 'POST' }))}>
                  Beitreten
                </button>
                <button disabled={busy || !isOpen} onClick={() => act('Eingereicht', () => api(`/v1/challenges/${id}/submit`, { method: 'POST' }))}>
                  Einsendung abgeben
                </button>
              </div>
            ) : (
              <p className="muted">Zum Mitmachen oben registrieren.</p>
            )}
          </div>

          <h2 style={{ fontSize: '1.1rem' }}>Einsendungen</h2>
          {!loggedIn && <p className="muted">Melde dich an, um Einsendungen zu sehen und abzustimmen.</p>}
          <div className="grid">
            {subs.map((s) => (
              <div key={s.id} className="card">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="muted" title={s.participantId}>
                    Teilnehmer {s.participantId.slice(0, 8)}…
                  </span>
                  <span className="badge">{s.status}</span>
                </div>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="muted">{s.voteCount} Stimmen</span>
                  <button
                    disabled={busy || s.status !== 'APPROVED'}
                    onClick={() => act('Abgestimmt', () => api(`/v1/challenges/${id}/vote`, { method: 'POST', body: { submissionId: s.id } }))}
                  >
                    Abstimmen
                  </button>
                </div>
              </div>
            ))}
            {loggedIn && subs.length === 0 && <p className="muted">Noch keine Einsendungen.</p>}
          </div>
        </>
      )}
    </>
  );
}
