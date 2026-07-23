import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { eases, prefersReducedMotion } from '../../lib/motion';
import { haptics } from '../../lib/haptics';
import { colors, fonts } from '../../lib/theme';

/** 3-2-1-Countdown vor der Aufnahme: Zahl skaliert je Sekunde, Ring pulst, Haptik-Tick.
 *  Zweck: Statusanzeige + Fokus (gleich geht's los). Reduced Motion: nur Zahlwechsel.
 *  onDone feuert nach der letzten Sekunde. */
export function CountdownRing({ from = 3, onDone }: { from?: number; onDone: () => void }) {
  const [n, setN] = useState(from);
  const scale = useRef(new Animated.Value(1)).current;
  const ring = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cur = from;
    haptics.medium();
    const step = () => {
      setN(cur);
      if (!prefersReducedMotion()) {
        scale.setValue(0.6);
        ring.setValue(0);
        Animated.parallel([
          Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 12, bounciness: 10 }),
          Animated.timing(ring, { toValue: 1, duration: 900, easing: eases.out, useNativeDriver: true }),
        ]).start();
      }
    };
    step();
    const id = setInterval(() => {
      cur -= 1;
      if (cur <= 0) {
        clearInterval(id);
        onDone();
      } else {
        haptics.medium();
        step();
      }
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ringScale = ring.interpolate({ inputRange: [0, 1], outputRange: [1, 1.5] });
  const ringOpacity = ring.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] });

  return (
    <View style={styles.wrap}>
      <View style={styles.box}>
        <Animated.View style={[styles.halo, { transform: [{ scale: ringScale }], opacity: ringOpacity }]} />
        <View style={styles.ring}>
          <Animated.Text style={[styles.num, { transform: [{ scale }] }]}>{n}</Animated.Text>
        </View>
      </View>
      <Text style={styles.label}>Mach dich bereit</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 14 },
  box: { width: 120, height: 120, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', width: 120, height: 120, borderRadius: 60, borderWidth: 2, borderColor: colors.accent },
  ring: {
    width: 108,
    height: 108,
    borderRadius: 54,
    borderWidth: 3,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  num: { fontFamily: fonts.heading, fontSize: 52, color: colors.text },
  label: { fontFamily: fonts.bodySemibold, fontSize: 13, color: colors.muted },
});
