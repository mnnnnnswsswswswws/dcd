import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { colors, fonts } from '../../lib/theme';
import { haptics } from '../../lib/haptics';
import { AnimatedPressable } from './AnimatedPressable';
import { RecordingPulse } from './RecordingPulse';

/**
 * Echte Kamera-Bühne: zeigt die Live-Gerätekamera als Hintergrund der Vorbereitungs-
 * und Aufnahme-Phase. Behandelt echte Berechtigungen (angefragt erst NACH erklärtem
 * Nutzen im Vorbereitungs-Screen) und den „verweigert/nicht verfügbar"-Zustand als
 * eigenen Fehlerzustand mit Wiederherstellung. Kein Galerie-Import — bewusst.
 */
export function CameraStage({
  mode,
  c,
  recSec,
  recLimit,
  onStartCam,
  onStop,
  onCancel,
}: {
  mode: 'prepare' | 'recording';
  c: { id: string; title: string };
  recSec: number;
  recLimit: number;
  onStartCam: () => void;
  onStop: () => void;
  onCancel: () => void;
}) {
  const [cam, reqCam] = useCameraPermissions();
  const [mic, reqMic] = useMicrophonePermissions();

  const loading = !cam || !mic;
  const denied = (cam && !cam.granted && !cam.canAskAgain) || (mic && !mic.granted && !mic.canAskAgain);
  const needsAsk = !loading && !denied && (!cam.granted || !mic.granted);
  const ready = !loading && cam.granted && mic.granted;

  // Auf einem echten Gerät automatisch anfragen, sobald der Nutzer die Kamera öffnet
  // (der Nutzen ist im Vorbereitungs-Screen davor bereits erklärt).
  useEffect(() => {
    if (needsAsk && cam?.canAskAgain !== false) {
      if (!cam?.granted) void reqCam();
      if (!mic?.granted) void reqMic();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsAsk]);

  async function ask() {
    haptics.selection();
    if (!cam?.granted) await reqCam();
    if (!mic?.granted) await reqMic();
  }

  // Fehlerzustand: Kamera/Mikro verweigert oder nicht verfügbar.
  if (denied) {
    return (
      <View style={styles.fallback}>
        <View style={styles.errBadge}>
          <Text style={styles.errGlyph}>📷</Text>
        </View>
        <Text style={styles.title}>Kein Kamerazugriff</Text>
        <Text style={styles.hint}>
          Für die In-App-Aufnahme brauchst du Kamera und Mikrofon. Aktiviere den Zugriff in den
          Einstellungen — ein Galerie-Upload ist bewusst nicht möglich.
        </Text>
        <AnimatedPressable onPress={ask} haptic="medium" style={styles.primary} label="Zugriff erneut anfragen">
          <Text style={styles.primaryTxt}>Erneut versuchen</Text>
        </AnimatedPressable>
        <AnimatedPressable onPress={onCancel} haptic="none" style={styles.ghost}>
          <Text style={styles.ghostTxt}>Zurück</Text>
        </AnimatedPressable>
      </View>
    );
  }

  if (loading || needsAsk) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.title}>Kamera &amp; Mikrofon</Text>
        <Text style={styles.hint}>
          Nimm deinen Beweis direkt in der App auf. Wir brauchen einmal Zugriff auf Kamera und Mikro.
        </Text>
        <AnimatedPressable onPress={ask} haptic="medium" style={styles.primary} label="Kamera erlauben">
          <Text style={styles.primaryTxt}>Kamera &amp; Mikro erlauben</Text>
        </AnimatedPressable>
        <AnimatedPressable onPress={onCancel} haptic="none" style={styles.ghost}>
          <Text style={styles.ghostTxt}>Abbrechen</Text>
        </AnimatedPressable>
      </View>
    );
  }

  // ready → echte Live-Vorschau als Hintergrund + Steuerung darüber.
  return (
    <View style={StyleSheet.absoluteFill}>
      <CameraView style={StyleSheet.absoluteFill} facing="front" mode="video" />
      <View style={styles.scrim} />

      {/* Beweis-Overlay — immer sichtbar, Nachweis der In-App-Herkunft */}
      <View style={styles.proof}>
        <View style={styles.recDotSmall} />
        <Text style={styles.proofTxt}>BEWEIS · {c.id.toUpperCase()}</Text>
      </View>

      {mode === 'prepare' ? (
        <View style={styles.controls}>
          <Text style={styles.goalLabel}>Deine Aufgabe</Text>
          <Text style={styles.goal}>{c.title}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.metaChip}>max {recLimit}s</Text>
            <Text style={[styles.metaChip, { color: colors.accent, borderColor: colors.accent }]}>● Kamera bereit</Text>
          </View>
          <AnimatedPressable onPress={onStartCam} haptic="medium" style={styles.recStart} label="Aufnahme starten">
            <View style={styles.recRing}>
              <View style={styles.recDot} />
            </View>
          </AnimatedPressable>
          <Text style={styles.tapHint}>Tippen zum Starten — 3-2-1</Text>
          <AnimatedPressable onPress={onCancel} haptic="none" style={styles.ghost}>
            <Text style={styles.ghostTxt}>Abbrechen</Text>
          </AnimatedPressable>
        </View>
      ) : (
        <View style={styles.controls}>
          <RecordingPulse seconds={recSec} />
          <Text style={[styles.limit, recSec >= recLimit - 5 && { color: '#f2b06d' }]}>
            {recSec} / {recLimit}s
          </Text>
          <AnimatedPressable onPress={onStop} haptic="medium" style={styles.stopBtn} label="Stoppen">
            <View style={styles.stopInner} />
            <Text style={styles.stopTxt}>Stoppen</Text>
          </AnimatedPressable>
        </View>
      )}
    </View>
  );
}

const REC = '#f2696e';
const styles = StyleSheet.create({
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(10,11,13,0.35)' },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },
  errBadge: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  errGlyph: { fontSize: 32 },
  title: { fontFamily: fonts.heading, fontSize: 22, color: colors.text, textAlign: 'center' },
  hint: { fontFamily: fonts.body, fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20, maxWidth: 320 },
  primary: { backgroundColor: colors.accent, paddingVertical: 15, paddingHorizontal: 28, borderRadius: 13, marginTop: 6 },
  primaryTxt: { fontFamily: fonts.heading, fontSize: 15, color: colors.accentInk },
  ghost: { paddingVertical: 9 },
  ghostTxt: { fontFamily: fonts.bodySemibold, fontSize: 14, color: colors.muted },

  proof: { position: 'absolute', top: 46, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 11, paddingVertical: 5, borderRadius: 7 },
  recDotSmall: { width: 8, height: 8, borderRadius: 4, backgroundColor: REC },
  proofTxt: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1, color: '#fff' },

  controls: { position: 'absolute', left: 0, right: 0, bottom: 40, alignItems: 'center', gap: 12, paddingHorizontal: 24 },
  goalLabel: { fontFamily: fonts.bodySemibold, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,0.7)' },
  goal: { fontFamily: fonts.heading, fontSize: 20, color: '#fff', textAlign: 'center' },
  metaRow: { flexDirection: 'row', gap: 10 },
  metaChip: { fontFamily: fonts.bodySemibold, fontSize: 12, color: '#fff', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  recStart: { marginTop: 4 },
  recRing: { width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: 'rgba(255,255,255,0.5)', alignItems: 'center', justifyContent: 'center' },
  recDot: { width: 56, height: 56, borderRadius: 28, backgroundColor: REC },
  tapHint: { fontFamily: fonts.body, fontSize: 13, color: 'rgba(255,255,255,0.75)' },
  limit: { fontFamily: fonts.heading, fontSize: 15, color: 'rgba(255,255,255,0.8)', fontVariant: ['tabular-nums'] },
  stopBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(242,105,110,0.2)', borderWidth: 1, borderColor: 'rgba(242,105,110,0.6)', paddingVertical: 14, paddingHorizontal: 24, borderRadius: 13 },
  stopInner: { width: 16, height: 16, borderRadius: 4, backgroundColor: REC },
  stopTxt: { fontFamily: fonts.bodyBold, fontSize: 15, color: '#fff' },
});
