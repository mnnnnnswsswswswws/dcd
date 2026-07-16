'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, euro, getConfig } from '../../lib/api';
import { AccountBar } from '../account-bar';

interface CreatedResult {
  challenge: { id: string; status: string; prizeAmountCents: number };
  funding: { providerRef: string; clientSecret: string; amountCents: number };
}

function defaultDeadline(): string {
  // datetime-local-Format (lokale Zeit), Standard: in 7 Tagen.
  const d = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function CreatePage() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [prizeEuro, setPrizeEuro] = useState('100');
  const [mode, setMode] = useState('CREATOR_DECIDES');
  const [deadline, setDeadline] = useState('');
  const [result, setResult] = useState<CreatedResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDeadline(defaultDeadline());
    setLoggedIn(Boolean(getConfig().token));
  }, []);

  async function submit() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const prizeAmountCents = Math.round(Number(prizeEuro) * 100);
      const body = {
        selectionMode: mode,
        prizeAmountCents,
        submissionDeadline: new Date(deadline).toISOString(),
      };
      setResult(await api<CreatedResult>('/v1/challenges', { method: 'POST', body }));
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
      <h1>Challenge erstellen</h1>
      <AccountBar onChange={() => setLoggedIn(Boolean(getConfig().token))} />

      {!loggedIn && <p className="muted">Bitte oben registrieren, um eine Challenge zu erstellen.</p>}
      {error && <p className="error">Fehler: {error}</p>}

      {loggedIn && !result && (
        <div className="card grid" style={{ maxWidth: 460 }}>
          <label>
            Preisgeld (EUR)
            <input type="number" min="1" step="1" value={prizeEuro} onChange={(e) => setPrizeEuro(e.target.value)} />
          </label>
          <label>
            Auswahlmodus
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="CREATOR_DECIDES">Ersteller entscheidet</option>
              <option value="COMMUNITY_VOTE">Community-Voting</option>
            </select>
          </label>
          <label>
            Einsendeschluss
            <input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </label>
          <button className="primary" onClick={submit} disabled={busy}>
            {busy ? 'Erstelle…' : 'Challenge erstellen'}
          </button>
        </div>
      )}

      {result && (
        <div className="card">
          <p>
            <strong>Erstellt</strong> — Status <span className="badge">{result.challenge.status}</span>,
            Preisgeld {euro(result.challenge.prizeAmountCents)}.
          </p>
          <p className="muted">
            Vollfinanzierung ausstehend. Zahlungs-Referenz: <code>{result.funding.providerRef}</code>
            <br />
            Client-Secret (für die Bezahlung, später via Stripe.js): <code>{result.funding.clientSecret}</code>
          </p>
          <p className="muted">
            Sobald die Zahlung per Webhook bestätigt ist, wird die Challenge veröffentlicht.
          </p>
          <Link href={`/challenges/${result.challenge.id}`}>Zur Challenge →</Link>
        </div>
      )}
    </>
  );
}
