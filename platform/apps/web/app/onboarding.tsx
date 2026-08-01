'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { api, avatarColor, categoryEmoji, euro, getToken, subscribeSession, type ChallengeSummary } from '../lib/api';

const ONBOARDED_KEY = 'vcp.onboarded';

/**
 * Onboarding — Abschnitt 1: „Der Reveal".
 * Kein Erklär-Intro. Kalter Einstieg auf ECHTE, laufende Challenges (aus der API,
 * nach Preisgeld sortiert): hochzählendes Preisgeld als Held, echter Live-Beleg
 * (Teilnehmerzahl, Restplätze, Frist, Likes), eine Hauptaktion. Wert wird gefühlt,
 * nicht erklärt. Registrierung passiert NICHT hier — der Nutzer landet danach im
 * echten Feed und meldet sich erst bei Teilnahme an.
 */
export function Onboarding() {
  const [show, setShow] = useState(false);
  const [items, setItems] = useState<ChallengeSummary[] | null>(null);
  const [i, setI] = useState(0);

  useEffect(() => {
    const decide = () => {
      const seen = typeof window !== 'undefined' && window.localStorage.getItem(ONBOARDED_KEY);
      setShow(!getToken() && !seen);
    };
    decide();
    return subscribeSession(decide);
  }, []);

  // Echte Challenges laden, wenn das Onboarding sichtbar ist.
  useEffect(() => {
    if (!show || items !== null) return;
    void (async () => {
      try {
        const list = await api<ChallengeSummary[]>('/v1/challenges?status=OPEN', { auth: false });
        const top = [...list].sort((a, b) => b.prizeAmountCents - a.prizeAmountCents).slice(0, 3);
        setItems(top);
      } catch {
        setItems([]);
      }
    })();
  }, [show, items]);

  if (!show) return null;

  function finish() {
    window.localStorage.setItem(ONBOARDED_KEY, '1');
    setShow(false);
  }

  // Ladezustand: Produkt-Skeleton, kein Spinner.
  if (items === null) {
    return (
      <div className="onb" role="dialog" aria-modal="true" aria-label="Wird geladen">
        <div className="rv">
          <div className="skel" style={{ width: 120, height: 20, borderRadius: 999 }} />
          <div className="skel" style={{ width: '80%', height: 34, marginTop: 22 }} />
          <div className="skel" style={{ width: 180, height: 70, marginTop: 16 }} />
          <div className="skel" style={{ width: '90%', height: 44, marginTop: 24, borderRadius: 12 }} />
        </div>
      </div>
    );
  }

  // Leerzustand: ehrlich und einladend, keine Sackgasse.
  if (items.length === 0) {
    return (
      <div className="onb" role="dialog" aria-modal="true" aria-label="Willkommen">
        <div className="rv rv-empty">
          <div className="rv-kicker"><span className="rv-dot" /> Noch ruhig hier</div>
          <h1 className="rv-title">Sei die oder der Erste.</h1>
          <p className="rv-line">Gerade läuft keine Challenge. Starte deine eigene — setz ein Preisgeld aus und schau, wer sich traut.</p>
          <div className="rv-actions">
            <a className="onb-primary" href="/create" onClick={finish}>Challenge starten</a>
            <button className="onb-back" onClick={finish}>Erst mal umsehen</button>
          </div>
        </div>
      </div>
    );
  }

  const c = items[i];
  const last = i === items.length - 1;

  return (
    <div className="onb" role="dialog" aria-modal="true" aria-label="Gerade live">
      <div className="onb-top">
        <span className="rv-kicker"><span className="rv-dot" /> Gerade live</span>
        <button className="onb-skip" onClick={finish}>Überspringen</button>
      </div>

      <RevealCard key={c.id} c={c} />

      <div className="onb-dots" aria-hidden>
        {items.map((it, k) => (
          <span key={it.id} className={`onb-dot-nav${k === i ? ' on' : ''}`} />
        ))}
      </div>

      <div className="rv-actions">
        <button
          className="onb-primary"
          onClick={() => (last ? finish() : setI((v) => v + 1))}
        >
          {last ? 'Los, mein Feed' : 'Nächste ansehen'}
          <span aria-hidden> →</span>
        </button>
        {i > 0 && (
          <button className="onb-back" onClick={() => setI((v) => v - 1)}>Zurück</button>
        )}
      </div>
    </div>
  );
}

/** Eine echte Challenge, cinematisch: Held-Zahl (Preisgeld) + Live-Beleg. */
function RevealCard({ c }: { c: ChallengeSummary }) {
  const euros = Math.round(c.prizeAmountCents / 100);
  const shown = useCountUp(euros);
  const free = Math.max(0, c.maxSlots - (c.occupiedSlots ?? 0));
  const joined = c.occupiedSlots ?? 0;
  const handle = c.creator?.username ?? c.creator?.displayName?.replace(/\s+/g, '').toLowerCase() ?? 'creator';
  const days = useMemo(() => deadlineDays(c.submissionDeadline), [c.submissionDeadline]);

  // Bis zu 5 Identitäts-Punkte, Anzahl = echte Teilnehmerzahl.
  const dots = Array.from({ length: Math.min(joined, 5) }, (_, k) => avatarColor(`${c.id}:${k}`));

  return (
    <div className="rv">
      <div className="rv-cat">
        <span className="rv-cat-glyph">{categoryEmoji(c.category, c.title)}</span>
        {c.category ?? 'Challenge'}
      </div>

      <h1 className="rv-title">{c.title || 'Ohne Titel'}</h1>

      <div className="rv-prize">
        <span className="rv-prize-label">Preisgeld · zu gewinnen</span>
        <span className="rv-prize-num">{euro(shown * 100)}</span>
      </div>

      <p className="rv-line">
        Zeig, was du drauf hast — nimm deinen Beweis in der App auf. Die Community kürt den
        Gewinner. Das Preisgeld ist echt.
      </p>

      <div className="rv-proof">
        {joined > 0 ? (
          <div className="rv-crowd">
            <span className="rv-avatars">
              {dots.map((col, k) => (
                <span key={k} className="rv-av" style={{ background: col, zIndex: 5 - k }} />
              ))}
            </span>
            <span className="rv-proof-txt">
              <strong>{joined}</strong> {joined === 1 ? 'ist' : 'sind'} dabei · {free} frei
            </span>
          </div>
        ) : (
          <span className="rv-proof-txt">
            <strong>Sei die oder der Erste</strong> · {free} Plätze frei
          </span>
        )}
        <span className="rv-meta">
          {days !== null && <span className="rv-chip">endet in {days} {days === 1 ? 'Tag' : 'Tagen'}</span>}
          <span className="rv-by">
            <span className="rv-av rv-av-solo" style={{ background: avatarColor('@' + handle) }}>
              {handle.charAt(0).toUpperCase()}
            </span>
            @{handle}
          </span>
        </span>
      </div>
    </div>
  );
}

/** Zählt weich auf den Zielwert hoch (ease-out). Respektiert reduced-motion. */
function useCountUp(target: number): number {
  const [val, setVal] = useState(0);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || target <= 0) {
      setVal(target);
      return;
    }
    const start = performance.now();
    const dur = 900;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setVal(Math.round(eased * target));
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [target]);
  return val;
}

function deadlineDays(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 0;
  return Math.max(1, Math.ceil(ms / 86_400_000));
}
