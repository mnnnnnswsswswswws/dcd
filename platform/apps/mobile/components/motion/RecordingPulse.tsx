import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { eases, prefersReducedMotion } from '../../lib/motion';
import { colors, fonts } from '../../lib/theme';

/** Pulsierender Aufnahmering + Timer. Zweck: Statusanzeige „nimmt gerade auf".
 *  Reduced Motion: statischer Ring, kein Puls. */
export function RecordingPulse({ seconds }: { seconds: number }) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: eases.inout, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 700, easing: eases.inout, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] });
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');

  return (
    <View style={styles.wrap}>
      <View style={styles.ringBox}>
        <Animated.View style={[styles.halo, { transform: [{ scale: ringScale }], opacity: ringOpacity }]} />
        <View style={styles.dot} />
      </View>
      <Text style={styles.timer}>
        {mm}:{ss}
      </Text>
      <Text style={styles.label}>Aufnahme läuft</Text>
    </View>
  );
}

const REC = '#f2696e';
const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 10 },
  ringBox: { width: 84, height: 84, alignItems: 'center', justifyContent: 'center' },
  halo: {
    position: 'absolute',
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 2,
    borderColor: REC,
  },
  dot: { width: 26, height: 26, borderRadius: 7, backgroundColor: REC },
  timer: { fontFamily: fonts.heading, fontSize: 30, color: colors.text, fontVariant: ['tabular-nums'] },
  label: {
    fontFamily: fonts.bodySemibold,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: REC,
  },
});
