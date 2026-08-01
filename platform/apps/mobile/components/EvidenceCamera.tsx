import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { FileSystemUploadType, uploadAsync } from 'expo-file-system/legacy';
import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { api, type EvidenceIntent } from '../lib/api';
import { colors, fonts } from '../lib/theme';
import { Button, ErrorText, Muted, Row } from './ui';

type Phase = 'idle' | 'recording' | 'recorded' | 'submitting';

/**
 * In-App-Beweisaufnahme (Spec: ohne Galerieimport, ohne Schnitt). Nimmt live über die
 * Gerätekamera auf — es gibt bewusst keinen Galerie-/Datei-Zugriff. Danach: Upload-Absicht
 * holen, bei echtem Storage hochladen (Mock-URL wird übersprungen), mit Ref einreichen.
 */
export function EvidenceCamera({
  challengeId,
  onSubmitted,
  onCancel,
}: {
  challengeId: string;
  onSubmitted: () => void;
  onCancel: () => void;
}) {
  const cameraRef = useRef<CameraView>(null);
  const [camPerm, requestCamPerm] = useCameraPermissions();
  const [micPerm, requestMicPerm] = useMicrophonePermissions();
  const [phase, setPhase] = useState<Phase>('idle');
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ready = camPerm?.granted && micPerm?.granted;

  if (!camPerm || !micPerm) {
    return (
      <View style={styles.wrap}>
        <Muted>Berechtigungen werden geladen…</Muted>
      </View>
    );
  }

  if (!ready) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>Kamera-Zugriff nötig</Text>
        <Muted>
          Für die In-App-Aufnahme brauchen wir Kamera und Mikrofon. Ein Galerie-Upload ist bewusst nicht möglich.
        </Muted>
        <Row>
          {!camPerm.granted && <Button title="Kamera erlauben" variant="primary" onPress={requestCamPerm} />}
          {!micPerm.granted && <Button title="Mikrofon erlauben" variant="primary" onPress={requestMicPerm} />}
          <Button title="Abbrechen" onPress={onCancel} />
        </Row>
      </View>
    );
  }

  async function startRecording() {
    setError(null);
    setVideoUri(null);
    setPhase('recording');
    try {
      // recordAsync löst auf, wenn stopRecording() aufgerufen wurde.
      const result = await cameraRef.current?.recordAsync();
      if (result?.uri) {
        setVideoUri(result.uri);
        setPhase('recorded');
      } else {
        setPhase('idle');
      }
    } catch (e) {
      setError((e as Error).message);
      setPhase('idle');
    }
  }

  function stopRecording() {
    cameraRef.current?.stopRecording();
  }

  async function submit() {
    if (!videoUri) return;
    setPhase('submitting');
    setError(null);
    try {
      const intent = await api<EvidenceIntent>(`/v1/challenges/${challengeId}/evidence-intent`, {
        method: 'POST',
        body: { contentType: 'video/mp4' },
      });
      if (/^https?:/i.test(intent.uploadUrl)) {
        await uploadAsync(intent.uploadUrl, videoUri, {
          httpMethod: 'PUT',
          uploadType: FileSystemUploadType.BINARY_CONTENT,
          headers: { 'Content-Type': 'video/mp4' },
        });
      }
      await api(`/v1/challenges/${challengeId}/submit`, { method: 'POST', body: { evidenceRef: intent.evidenceRef } });
      onSubmitted();
    } catch (e) {
      setError((e as Error).message);
      setPhase('recorded');
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Beweis in der App aufnehmen</Text>
      <View style={styles.preview}>
        <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="front" mode="video" />
      </View>
      {error && <ErrorText>{error}</ErrorText>}
      <Row>
        {phase === 'idle' && (
          <Button title="● Aufnahme starten" variant="primary" onPress={startRecording} />
        )}
        {phase === 'recording' && (
          <Button title="■ Stoppen" variant="danger" onPress={stopRecording} />
        )}
        {phase === 'recorded' && (
          <>
            <Button title="Neu aufnehmen" onPress={startRecording} />
            <Button title="Einreichen" variant="primary" onPress={submit} />
          </>
        )}
        {phase === 'submitting' && <Muted>Reiche ein…</Muted>}
        <Button title="Schließen" onPress={onCancel} />
      </Row>
      <Muted>Aufnahme ausschließlich live in der App — kein Galerie-Import, kein Schnitt.</Muted>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    gap: 10,
  },
  title: { fontSize: 16, fontFamily: fonts.heading, color: colors.text },
  preview: {
    width: '100%',
    aspectRatio: 9 / 16,
    maxHeight: 380,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
});
