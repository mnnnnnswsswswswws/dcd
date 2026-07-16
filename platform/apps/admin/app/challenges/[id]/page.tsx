'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, euro, type SubmissionRow } from '../../../lib/api';
import { SettingsBar } from '../../settings-bar';

interface ChallengeDetail {
  id: string;
  status: string;
  selectionMode: string;
  prizeAmountCents: number;
  maxSlots: number;
  submissionDeadline: string | null;
  occupiedSlots: number;
}

export default function ChallengeDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [challenge, setChallenge] = useState<ChallengeDetail | null>(null);
  const [subs, setSubs] = useState<SubmissionRow[]>([]);
  const [winner, setWinner] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [c, s] = await Promise.all([
        api<ChallengeDetail>(`/v1/challenges/${id}`, { auth: false }),
        api<SubmissionRow[]>(`/v1/challenges/${id}/submissions`),
      ]);
      setChallenge(c);
      setSubs(s);
    } catch (e) {
      setError((e as Error).message);
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

  return (
    <>
      <p>
        <Link href="/">← Übersicht</Link>
      </p>
      <h1>Challenge</h1>
      <SettingsBar onChange={load} />

      {error && <p className="error">Fehler: {error}</p>}
      {note && <p className="muted">{note}</p>}

      {challenge && (
        <>
          <p className="row">
            <span className="badge">{challenge.status}</span>
            <span>{challenge.selectionMode}</span>
            <span>{euro(challenge.prizeAmountCents)}</span>
            <span className="muted">
              Plätze: {challenge.occupiedSlots}/{challenge.maxSlots}
            </span>
          </p>

          <div className="row" style={{ margin: '12px 0' }}>
            <button disabled={busy} onClick={() => act('Einsendeschluss', () => api(`/v1/challenges/${id}/close`, { method: 'POST' }))}>
              Einsendeschluss
            </button>
            <button
              disabled={busy || !winner}
              onClick={() =>
                act('Gewinner gewählt', () =>
                  api(`/v1/challenges/${id}/select-winner`, { method: 'POST', body: { winnerSubmissionId: winner || undefined } }),
                )
              }
            >
              Gewinner wählen
            </button>
            <button disabled={busy} onClick={() => act('Auszahlung', () => api(`/v1/challenges/${id}/payout`, { method: 'POST' }))}>
              Auszahlung
            </button>
            <button disabled={busy} onClick={() => act('Abgebrochen', () => api(`/v1/challenges/${id}/cancel`, { method: 'POST' }))}>
              Abbrechen
            </button>
          </div>

          <h2 style={{ fontSize: '1.1rem' }}>Einsendungen</h2>
          <table>
            <thead>
              <tr>
                <th />
                <th>Teilnehmer</th>
                <th>Status</th>
                <th>Stimmen</th>
                <th>Moderation</th>
              </tr>
            </thead>
            <tbody>
              {subs.map((s) => (
                <tr key={s.id}>
                  <td>
                    <input
                      type="radio"
                      name="winner"
                      value={s.id}
                      checked={winner === s.id}
                      onChange={() => setWinner(s.id)}
                      disabled={s.status !== 'APPROVED'}
                    />
                  </td>
                  <td className="muted" title={s.participantId}>
                    {s.participantId.slice(0, 8)}…
                  </td>
                  <td>
                    <span className="badge">{s.status}</span>
                  </td>
                  <td>{s.voteCount}</td>
                  <td className="row">
                    <button
                      disabled={busy || s.status !== 'SUBMITTED'}
                      onClick={() => act('Freigegeben', () => api(`/v1/submissions/${s.id}/moderate`, { method: 'POST', body: { decision: 'APPROVED' } }))}
                    >
                      Freigeben
                    </button>
                    <button
                      disabled={busy || s.status !== 'SUBMITTED'}
                      onClick={() => act('Abgelehnt', () => api(`/v1/submissions/${s.id}/moderate`, { method: 'POST', body: { decision: 'REJECTED' } }))}
                    >
                      Ablehnen
                    </button>
                  </td>
                </tr>
              ))}
              {subs.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    Keine Einsendungen.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
