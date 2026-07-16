'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, euro, CHALLENGE_STATUSES, type ChallengeSummary } from '../lib/api';
import { SettingsBar } from './settings-bar';

export default function DashboardPage() {
  const [status, setStatus] = useState<string>('');
  const [challenges, setChallenges] = useState<ChallengeSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = status ? `?status=${status}` : '';
      setChallenges(await api<ChallengeSummary[]>(`/v1/challenges${query}`, { auth: false }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <h1>Video-Challenge Admin</h1>
      <SettingsBar onChange={load} />

      <div className="row" style={{ marginBottom: 12 }}>
        <label>
          Status-Filter
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Alle</option>
            {CHALLENGE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <button onClick={load} disabled={loading}>
          {loading ? 'Lädt…' : 'Aktualisieren'}
        </button>
      </div>

      {error && <p className="error">Fehler: {error}</p>}

      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Modus</th>
            <th>Preis</th>
            <th>Frist</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {challenges.map((c) => (
            <tr key={c.id}>
              <td>
                <span className="badge">{c.status}</span>
              </td>
              <td>{c.selectionMode}</td>
              <td>{euro(c.prizeAmountCents)}</td>
              <td className="muted">{c.submissionDeadline ? new Date(c.submissionDeadline).toLocaleString('de-DE') : '—'}</td>
              <td>
                <Link href={`/challenges/${c.id}`}>Öffnen →</Link>
              </td>
            </tr>
          ))}
          {challenges.length === 0 && !loading && (
            <tr>
              <td colSpan={5} className="muted">
                Keine Challenges gefunden.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
