'use client';

import { useState } from 'react';
import { api, REPORT_REASONS } from '../lib/api';

/**
 * Kompakte Melde-Aktion (Safety, Spec 14.5): öffnet einen Grund-Dialog und sendet
 * `POST /v1/reports`. Sichtbar nur für angemeldete Nutzer.
 */
export function ReportButton({
  targetType,
  targetId,
  disabled,
}: {
  targetType: 'SUBMISSION' | 'CHALLENGE' | 'USER';
  targetId: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(REPORT_REASONS[0].value);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await api('/v1/reports', { method: 'POST', body: { targetType, targetId, reason } });
      setDone(true);
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return <span className="muted" style={{ fontSize: '0.8rem' }}>Gemeldet ✓</span>;
  }

  if (!open) {
    return (
      <button className="sm ghost" disabled={disabled} onClick={() => setOpen(true)} title="Melden">
        Melden
      </button>
    );
  }

  return (
    <span className="row" style={{ gap: 4 }}>
      <select value={reason} onChange={(e) => setReason(e.target.value)} style={{ padding: '4px 6px', fontSize: '0.8rem' }}>
        {REPORT_REASONS.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
      <button className="sm primary" disabled={busy} onClick={send}>
        Senden
      </button>
      <button className="sm ghost" disabled={busy} onClick={() => setOpen(false)}>
        Abbrechen
      </button>
      {error && <span className="error" style={{ fontSize: '0.75rem' }}>{error}</span>}
    </span>
  );
}
