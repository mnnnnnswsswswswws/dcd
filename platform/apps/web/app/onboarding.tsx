'use client';

import { useEffect, useState } from 'react';
import { getToken, register, subscribeSession } from '../lib/api';

const ONBOARDED_KEY = 'vcp.onboarded';

/** Reibungsloses Onboarding: kurzer Value-Slider → Anmeldung in einem Schritt →
 *  direkt in den Feed. Erscheint beim ersten Besuch (kein Token, noch nicht gesehen)
 *  und lässt sich jederzeit überspringen. Bewusst wenig Reibung: nur 18+ und ein
 *  optionaler Nutzername. */
const SLIDES = [
  {
    emoji: '🎬',
    title: 'Entdecke Challenges',
    text: 'Wisch dich durch Video-Challenges mit echtem Preisgeld — Sport, Kochen, Kreatives. Jeden Tag Neues.',
    tint: '#7aa2f7',
  },
  {
    emoji: '🎥',
    title: 'Mach mit — direkt in der App',
    text: 'Sichere dir einen Platz und nimm deinen Beweis in der App auf. Kein Galerie-Import, kein Schnitt, kein Fake.',
    tint: '#5ec2a0',
  },
  {
    emoji: '🏆',
    title: 'Gewinne echtes Preisgeld',
    text: 'Community-Voting oder der Ersteller kürt den Gewinner. Fair, transparent — und ausgezahlt.',
    tint: '#d3a24a',
  },
];

export function Onboarding() {
  const [show, setShow] = useState(false);
  const [step, setStep] = useState(0); // 0..2 Slides, 3 = Anmeldung
  const [adult, setAdult] = useState(false);
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Nur beim ersten Besuch zeigen: kein Token und noch nicht abgeschlossen/übersprungen.
  useEffect(() => {
    const decide = () => {
      const seen = typeof window !== 'undefined' && window.localStorage.getItem(ONBOARDED_KEY);
      setShow(!getToken() && !seen);
    };
    decide();
    return subscribeSession(decide);
  }, []);

  if (!show) return null;

  function finish() {
    window.localStorage.setItem(ONBOARDED_KEY, '1');
    setShow(false);
  }

  const isSignup = step === SLIDES.length;

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await register(username);
      finish(); // Session-Event bringt Feed/Nav automatisch in den angemeldeten Zustand.
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="onb" role="dialog" aria-modal="true" aria-label="Willkommen">
      <button className="onb-skip" onClick={finish} aria-label="Überspringen">
        Überspringen
      </button>

      {!isSignup ? (
        <div className="onb-stage" key={step}>
          <div className="onb-art" style={{ background: `radial-gradient(circle at 50% 42%, ${SLIDES[step].tint}33, transparent 68%)` }}>
            <span className="onb-emoji">{SLIDES[step].emoji}</span>
          </div>
          <h2 className="onb-title">{SLIDES[step].title}</h2>
          <p className="onb-text">{SLIDES[step].text}</p>
        </div>
      ) : (
        <div className="onb-stage" key="signup">
          <div className="onb-art" style={{ background: 'radial-gradient(circle at 50% 42%, #46c98a33, transparent 68%)' }}>
            <span className="onb-emoji">🚀</span>
          </div>
          <h2 className="onb-title">Bereit? Los geht&apos;s.</h2>
          <p className="onb-text">Nur noch eins: bestätige dein Alter und wähl einen Namen (kannst du später ändern).</p>
          <div className="onb-form">
            <label className="onb-check">
              <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
              <span>Ich bin 18 Jahre oder älter</span>
            </label>
            <input
              className="onb-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Nutzername (optional)"
              maxLength={20}
              autoComplete="off"
            />
            {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
          </div>
        </div>
      )}

      <div className="onb-dots">
        {SLIDES.map((_, i) => (
          <span key={i} className={`onb-dot${i === Math.min(step, SLIDES.length - 1) && !isSignup ? ' on' : ''}${isSignup ? '' : ''}`} />
        ))}
        <span className={`onb-dot${isSignup ? ' on' : ''}`} />
      </div>

      <div className="onb-actions">
        {!isSignup ? (
          <button className="onb-primary" onClick={() => setStep((s) => s + 1)}>
            {step === SLIDES.length - 1 ? 'Anmelden' : 'Weiter'}
          </button>
        ) : (
          <button className="onb-primary" onClick={start} disabled={!adult || busy}>
            {busy ? 'Einen Moment…' : 'Los geht’s'}
          </button>
        )}
        {step > 0 && (
          <button className="onb-back" onClick={() => setStep((s) => s - 1)}>
            Zurück
          </button>
        )}
      </div>
    </div>
  );
}
