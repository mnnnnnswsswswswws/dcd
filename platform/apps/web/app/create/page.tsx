'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, euro, getToken, selectionModeLabel, subscribeSession } from '../../lib/api';

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
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [prizeEuro, setPrizeEuro] = useState('100');
  const [mode, setMode] = useState('CREATOR_DECIDES');
  const [deadline, setDeadline] = useState('');
  const [result, setResult] = useState<CreatedResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDeadline(defaultDeadline());
    const sync = () => setLoggedIn(Boolean(getToken()));
    sync();
    return subscribeSession(sync);
  }, []);

  async function submit() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const prizeAmountCents = Math.round(Number(prizeEuro) * 100);
      const body = {
        title: title.trim(),
        description: description.trim() || undefined,
        category: category.trim() || undefined,
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

      {!loggedIn && (
        <div className="note">Bitte oben rechts registrieren (18+), um eine Challenge zu erstellen.</div>
      )}
      {error && <p className="error">Fehler: {error}</p>}

      {loggedIn && !result && (
        <div className="card stack">
          <label>
            Titel
            <input maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="z. B. Bester Freiwurf" />
          </label>
          <label>
            Beschreibung
            <textarea maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Worum geht es? Was zählt als gültiger Beweis?" />
          </label>
          <label>
            Kategorie
            <input maxLength={80} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="z. B. Sport & Skills" />
          </label>
          <div className="row" style={{ gap: 12 }}>
            <label style={{ flex: '1 1 140px' }}>
              Preisgeld (EUR)
              <input type="number" min="1" step="1" value={prizeEuro} onChange={(e) => setPrizeEuro(e.target.value)} />
            </label>
            <label style={{ flex: '1 1 180px' }}>
              Auswahlmodus
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="CREATOR_DECIDES">{selectionModeLabel('CREATOR_DECIDES')}</option>
                <option value="COMMUNITY_VOTE">{selectionModeLabel('COMMUNITY_VOTE')}</option>
              </select>
            </label>
          </div>
          <label>
            Einsendeschluss
            <input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </label>
          <p className="muted" style={{ fontSize: '0.82rem', margin: 0 }}>
            Der Auswahlmodus wird jetzt festgelegt und ist später unveränderlich. Die Challenge wird erst
            veröffentlicht, wenn das Preisgeld vollständig bezahlt ist.
          </p>
          <button className="primary" onClick={submit} disabled={busy || title.trim().length === 0}>
            {busy ? 'Erstelle…' : 'Challenge erstellen'}
          </button>
        </div>
      )}

      {result && (
        <div className="card stack">
          <div className="row between">
            <strong>Challenge erstellt</strong>
            <span className="prize">{euro(result.challenge.prizeAmountCents)}</span>
          </div>
          <span className="badge">Finanzierung ausstehend</span>
          <div className="note">
            Als Nächstes wird das Preisgeld bezahlt. Erst wenn die Zahlung per Webhook bestätigt ist, geht die
            Challenge automatisch öffentlich — eine Erfolgsmeldung im Browser genügt bewusst nicht.
            <div style={{ marginTop: 8 }}>
              Zahlungs-Referenz: <code>{result.funding.providerRef}</code>
              <br />
              Client-Secret (später via Stripe.js): <code>{result.funding.clientSecret}</code>
            </div>
          </div>
          <Link href={`/challenges/${result.challenge.id}`}>Zur Challenge →</Link>
        </div>
      )}
    </>
  );
}
