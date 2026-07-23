import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { eases } from '../../lib/motion';
import { colors, fonts } from '../../lib/theme';
import { AnimatedPressable } from './AnimatedPressable';

export type UploadState = 'uploading' | 'error' | 'done';

/** Upload-Fortschritt: echter Balken (0..1), nicht blockierend, mit Fehler+Retry.
 *  Zweck: Statusanzeige + Fehlererkennung. */
export function UploadProgress({
  progress,
  state,
  onRetry,
}: {
  progress: number; // 0..1
  state: UploadState;
  onRetry?: () => void;
}) {
  const w = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(w, { toValue: Math.max(0, Math.min(1, progress)), duration: 240, easing: eases.out, useNativeDriver: false }).start();
  }, [progress, w]);

  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  const isErr = state === 'error';
  const barColor = isErr ? '#f2696e' : colors.accent;

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Text style={styles.label}>
          {state === 'done' ? 'Hochgeladen' : isErr ? 'Upload unterbrochen' : 'Lädt hoch…'}
        </Text>
        <Text style={[styles.pct, isErr && { color: '#f2696e' }]}>{isErr ? '!' : `${pct}%`}</Text>
      </View>
      <View style={styles.track}>
        <Animated.View
          style={[
            styles.fill,
            { backgroundColor: barColor, width: w.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
          ]}
        />
      </View>
      {isErr && (
        <AnimatedPressable onPress={onRetry} haptic="medium" style={styles.retry}>
          <Text style={styles.retryTxt}>Nochmal versuchen</Text>
        </AnimatedPressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', gap: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontFamily: fonts.bodySemibold, fontSize: 13, color: colors.muted },
  pct: { fontFamily: fonts.heading, fontSize: 14, color: colors.text, fontVariant: ['tabular-nums'] },
  track: { height: 8, borderRadius: 999, backgroundColor: colors.bg2, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  fill: { height: '100%', borderRadius: 999 },
  retry: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(242,105,110,0.5)',
  },
  retryTxt: { fontFamily: fonts.bodyBold, fontSize: 13, color: '#f2696e' },
});
