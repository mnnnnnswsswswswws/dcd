'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type EvidenceIntent } from '../lib/api';

type Phase = 'idle' | 'ready' | 'recording' | 'recorded' | 'submitting';

/**
 * In-App-Beweisaufnahme (Spec: ohne Galerieimport, ohne Schnitt). Nimmt ausschließlich
 * live über Kamera/Mikrofon auf — es gibt bewusst kein Datei-Upload-Feld. Nach der Aufnahme
 * wird eine Upload-Absicht geholt, die Aufnahme (bei echtem Storage) hochgeladen und die
 * Einsendung mit dem Beweis-Ref eingereicht.
 */
export function EvidenceRecorder({
  challengeId,
  onSubmitted,
  onCancel,
}: {
  challengeId: string;
  onSubmitted: () => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: true });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true;
        await videoRef.current.play().catch(() => {});
      }
      setPhase('ready');
    } catch {
      setError('Kein Kamerazugriff. Bitte Kamera/Mikrofon erlauben — Galerie-Uploads sind nicht möglich.');
    }
  }, []);

  useEffect(() => {
    void startCamera();
    return () => stopStream();
  }, [startCamera, stopStream]);

  function startRecording() {
    if (!streamRef.current) return;
    chunksRef.current = [];
    setBlob(null);
    const mime = MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : '';
    const rec = new MediaRecorder(streamRef.current, mime ? { mimeType: mime } : undefined);
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      const recorded = new Blob(chunksRef.current, { type: 'video/webm' });
      setBlob(recorded);
      if (videoRef.current) {
        videoRef.current.srcObject = null;
        videoRef.current.src = URL.createObjectURL(recorded);
        videoRef.current.muted = false;
        videoRef.current.controls = true;
      }
      setPhase('recorded');
    };
    recorderRef.current = rec;
    rec.start();
    setPhase('recording');
  }

  function stopRecording() {
    recorderRef.current?.stop();
  }

  async function submit() {
    if (!blob) return;
    setPhase('submitting');
    setError(null);
    try {
      const intent = await api<EvidenceIntent>(`/v1/challenges/${challengeId}/evidence-intent`, {
        method: 'POST',
        body: { contentType: blob.type || 'video/webm' },
      });
      // Bei echtem Storage (http[s]-URL) die Aufnahme direkt hochladen; die Mock-URL
      // (mock://) hat kein Netzwerkziel und wird übersprungen.
      if (/^https?:/i.test(intent.uploadUrl)) {
        await fetch(intent.uploadUrl, { method: 'PUT', body: blob, headers: { 'Content-Type': blob.type || 'video/webm' } });
      }
      await api(`/v1/challenges/${challengeId}/submit`, { method: 'POST', body: { evidenceRef: intent.evidenceRef } });
      stopStream();
      onSubmitted();
    } catch (e) {
      setError((e as Error).message);
      setPhase('recorded');
    }
  }

  function cancel() {
    stopStream();
    onCancel();
  }

  return (
    <div className="card stack">
      <div className="row between">
        <strong>Beweis in der App aufnehmen</strong>
        <button className="sm ghost" onClick={cancel} disabled={phase === 'submitting'}>
          Schließen
        </button>
      </div>

      <video
        ref={videoRef}
        playsInline
        style={{ width: '100%', borderRadius: 10, background: '#000', aspectRatio: '9 / 16', maxHeight: 420, objectFit: 'cover' }}
      />

      {error && <p className="error">{error}</p>}

      <div className="row">
        {phase === 'ready' && (
          <button className="primary" onClick={startRecording}>
            ● Aufnahme starten
          </button>
        )}
        {phase === 'recording' && (
          <button className="danger" onClick={stopRecording}>
            ■ Stoppen
          </button>
        )}
        {phase === 'recorded' && (
          <>
            <button className="ghost" onClick={startCamera}>
              Neu aufnehmen
            </button>
            <button className="primary" onClick={submit}>
              Einreichen
            </button>
          </>
        )}
        {phase === 'submitting' && <span className="muted">Reiche ein…</span>}
        {phase === 'idle' && <span className="muted">Kamera wird vorbereitet…</span>}
      </div>

      <p className="muted" style={{ fontSize: '0.8rem', margin: 0 }}>
        Aufnahme ausschließlich live in der App — kein Galerie-Import, kein Schnitt.
      </p>
    </div>
  );
}
