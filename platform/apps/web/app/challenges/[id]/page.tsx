'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  api,
  euro,
  getToken,
  myUserId,
  selectionModeLabel,
  statusLabel,
  statusTone,
  subscribeSession,
  type ChallengeDetail,
  type MyChallenges,
  type PublicConfig,
  type SubmissionRow,
} from '../../../lib/api';
import { ReportButton } from '../../report-button';
import { EvidenceRecorder } from '../../evidence-recorder';

const TERMINAL = new Set(['WINNER_LOCKED', 'PAID_OUT', 'CANCELLED', 'EXPIRED']);
const SELECTABLE = new Set(['SUBMISSIONS_CLOSED', 'IN_REVIEW', 'SELECTION']);

function short(id: string): string {
  return id.slice(0, 8);
}

export default function ChallengePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [challenge, setChallenge] = useState<ChallengeDetail | null>(null);
  const [subs, setSubs] = useState<SubmissionRow[]>([]);
  const [slotStatus, setSlotStatus] = useState<string | null>(null);
  const [token, setTokenState] = useState('');
  const [selectedWinner, setSelectedWinner] = useState('');
  const [captureEnabled, setCaptureEnabled] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const t = getToken();
    setTokenState(t);
    try {
      setChallenge(await api<ChallengeDetail>(`/v1/challenges/${id}`, { auth: false }));
    } catch (e) {
      setError((e as Error).message);
    }
    try {
      const cfg = await api<PublicConfig>('/v1/config', { auth: false });
      setCaptureEnabled(cfg.longCaptureEnabled);
    } catch {
      setCaptureEnabled(false);
    }
    if (t) {
      try {
        setSubs(await api<SubmissionRow[]>(`/v1/challenges/${id}/submissions`));
      } catch {
        setSubs([]);
      }
      try {
        const mine = await api<MyChallenges>('/v1/users/me/challenges');
        const joined = mine.joined.find((c) => c.id === id);
        setSlotStatus(joined ? joined.slotStatus : null);
      } catch {
        setSlotStatus(null);
      }
    } else {
      setSubs([]);
      setSlotStatus(null);
    }
  }, [id]);

  useEffect(() => {
    void load();
    return subscribeSession(load);
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

  const loggedIn = Boolean(token);
  const myId = myUserId(token);
  const isCreator = loggedIn && challenge !== null && myId === challenge.creatorId;
  const status = challenge?.status ?? '';
  const isOpen = status === 'OPEN' || status === 'FULL';
  const isVote = challenge?.selectionMode === 'COMMUNITY_VOTE';
  const isTerminal = TERMINAL.has(status);

  const mySubmission = subs.find((s) => s.participantId === myId);
  const canJoin = loggedIn && !isCreator && isOpen && !slotStatus;
  const canSubmit = loggedIn && Boolean(slotStatus) && !mySubmission?.finalizedAt;
  const canClose = isCreator && isOpen;
  const canDecide = isCreator && SELECTABLE.has(status) && (isVote || Boolean(selectedWinner));
  const canCancel = isCreator && !isTerminal && status !== 'PAID_OUT';

  const slotPct = challenge ? Math.round((challenge.occupiedSlots / challenge.maxSlots) * 100) : 0;

  return (
    <>
      <p>
        <Link href="/">← Alle Challenges</Link>
      </p>

      {error && <p className="error">Fehler: {error}</p>}
      {note && <p className="note">{note}</p>}

      {challenge && (
        <>
          <div className="card stack">
            <div className="row between">
              <h1 style={{ margin: 0 }}>{challenge.title || 'Ohne Titel'}</h1>
              <span className="prize">{euro(challenge.prizeAmountCents)}</span>
            </div>
            <div className="row">
              <span className={`badge ${statusTone(status)}`}>{statusLabel(status)}</span>
              {challenge.category && <span className="badge">{challenge.category}</span>}
              <span className="badge">{selectionModeLabel(challenge.selectionMode)}</span>
              {isCreator && <span className="badge">Deine Challenge</span>}
            </div>

            {challenge.description && <p>{challenge.description}</p>}

            <div>
              <div className="row between" style={{ fontSize: '0.85rem' }}>
                <span className="muted">Teilnehmerplätze</span>
                <span className="muted">
                  {challenge.occupiedSlots}/{challenge.maxSlots}
                </span>
              </div>
              <div className="progress" style={{ marginTop: 4 }}>
                <span style={{ width: `${slotPct}%` }} />
              </div>
            </div>

            {challenge.criteria.length > 0 && (
              <div>
                <strong style={{ fontSize: '0.9rem' }}>Kriterien</strong>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {challenge.criteria.map((c) => (
                    <li key={c.id}>
                      {c.title}
                      {!c.mandatory && <span className="muted"> (optional)</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {challenge.winner && (
              <div className="note">
                Gewinner steht fest — ermittelt durch {selectionModeLabel(challenge.selectionMode)}.
              </div>
            )}
          </div>

          {/* Teilnahme */}
          {!loggedIn && <div className="note">Zum Mitmachen oben rechts registrieren (18+).</div>}
          {loggedIn && !isCreator && (
            <div className="card stack">
              <strong>Teilnehmen</strong>
              {slotStatus ? (
                <p className="muted" style={{ margin: 0 }}>
                  Dein Platz ist reserviert (Status: {slotStatus}).
                  {mySubmission
                    ? ` Deine Einsendung ist ${mySubmission.status}.`
                    : ' Reiche jetzt deinen In-App-Beweis ein.'}
                </p>
              ) : (
                <p className="muted" style={{ margin: 0 }}>
                  {isOpen ? 'Sichere dir einen der max. 10 Plätze.' : 'Diese Challenge nimmt keine neuen Teilnehmer mehr an.'}
                </p>
              )}
              <div className="row">
                <button className="primary" disabled={busy || !canJoin} onClick={() => act('Beigetreten', () => api(`/v1/challenges/${id}/join`, { method: 'POST' }))}>
                  Beitreten
                </button>
                <button
                  disabled={busy || !canSubmit || recording}
                  onClick={() => {
                    if (captureEnabled) {
                      setRecording(true);
                    } else {
                      void act('Eingereicht', () => api(`/v1/challenges/${id}/submit`, { method: 'POST' }));
                    }
                  }}
                >
                  Beweis einreichen
                </button>
              </div>
              <p className="muted" style={{ fontSize: '0.8rem', margin: 0 }}>
                Beweise werden ausschließlich in der App aufgenommen — kein Galerie-Import, kein Schnitt.
              </p>
            </div>
          )}

          {recording && (
            <EvidenceRecorder
              challengeId={id}
              onSubmitted={() => {
                setRecording(false);
                setNote('Eingereicht ✓');
                void load();
              }}
              onCancel={() => setRecording(false)}
            />
          )}

          {/* Ersteller-Verwaltung */}
          {isCreator && (
            <div className="card stack">
              <strong>Verwaltung</strong>
              <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>
                {isVote
                  ? 'Der Gewinner ergibt sich aus den Community-Stimmen.'
                  : 'Du wählst den Gewinner unter den freigegebenen Einsendungen aus.'}{' '}
                Moderation und Auszahlung erfolgen im Admin-Bereich.
              </p>
              <div className="row">
                <button className="ghost" disabled={busy || !canClose} onClick={() => act('Einsendeschluss gesetzt', () => api(`/v1/challenges/${id}/close`, { method: 'POST' }))}>
                  Einsendeschluss setzen
                </button>
                <button
                  className="primary"
                  disabled={busy || !canDecide}
                  onClick={() =>
                    act('Gewinner festgelegt', () =>
                      api(`/v1/challenges/${id}/select-winner`, {
                        method: 'POST',
                        body: { winnerSubmissionId: isVote ? undefined : selectedWinner || undefined },
                      }),
                    )
                  }
                >
                  {isVote ? 'Gewinner ermitteln' : 'Gewinner festlegen'}
                </button>
                <button className="danger" disabled={busy || !canCancel} onClick={() => act('Abgebrochen', () => api(`/v1/challenges/${id}/cancel`, { method: 'POST' }))}>
                  Abbrechen
                </button>
              </div>
            </div>
          )}

          {/* Einsendungen */}
          <h2>Einsendungen</h2>
          {!loggedIn && <p className="muted">Melde dich an, um Einsendungen zu sehen und abzustimmen.</p>}
          <div className="stack">
            {subs.map((s) => {
              const mine = s.participantId === myId;
              const canVote = isVote && loggedIn && !isTerminal && s.status === 'APPROVED';
              const canPickWinner = isCreator && !isVote && s.status === 'APPROVED' && SELECTABLE.has(status);
              return (
                <div key={s.id} className="sub">
                  <span className="avatar">{short(s.participantId).slice(0, 2).toUpperCase()}</span>
                  <div>
                    <div className="who">
                      Teilnehmer {short(s.participantId)}…{mine && <span className="muted"> (du)</span>}
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      <span className="badge">{s.status}</span>
                      <span className="muted" style={{ fontSize: '0.82rem' }}>
                        {s.voteCount} {s.voteCount === 1 ? 'Stimme' : 'Stimmen'}
                      </span>
                    </div>
                  </div>
                  <div className="spacer row" style={{ gap: 6 }}>
                    {canPickWinner && (
                      <label className="row" style={{ flexDirection: 'row', alignItems: 'center', gap: 4, fontSize: '0.8rem' }}>
                        <input
                          type="radio"
                          name="winner"
                          checked={selectedWinner === s.id}
                          onChange={() => setSelectedWinner(s.id)}
                        />
                        Gewinner
                      </label>
                    )}
                    {isVote && (
                      <button
                        className="sm ghost"
                        disabled={busy || !canVote}
                        onClick={() => act('Abgestimmt', () => api(`/v1/challenges/${id}/vote`, { method: 'POST', body: { submissionId: s.id } }))}
                      >
                        Abstimmen
                      </button>
                    )}
                    {loggedIn && !mine && <ReportButton targetType="SUBMISSION" targetId={s.id} disabled={busy} />}
                  </div>
                </div>
              );
            })}
            {loggedIn && subs.length === 0 && <p className="muted">Noch keine Einsendungen.</p>}
          </div>
        </>
      )}
    </>
  );
}
