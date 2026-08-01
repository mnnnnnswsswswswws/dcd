import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { eases, prefersReducedMotion } from '../../lib/motion';
import { colors, fonts } from '../../lib/theme';

/** Hochwertiger Erfolgsmoment: Haken federt in einen Ring, ein Ring expandiert einmal.
 *  Nicht kindlich, kein Konfetti. Zweck: Belohnung + Statuswechsel. Reduced Motion:
 *  einfacher Fade, kein Burst. */
export function SuccessBurst({ title, subtitle }: { title: string; subtitle?: string }) {
  const pop = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (prefersReducedMotion()) {
      pop.setValue(1);
      return;
    }
    Animated.sequence([
      Animated.spring(pop, { toValue: 1, useNativeDriver: true, speed: 12, bounciness: 12 }),
    ]).start();
    Animated.timing(ring, { toValue: 1, duration: 560, easing: eases.out, useNativeDriver: true }).start();
  }, [pop, ring]);

  const ringScale = ring.interpolate({ inputRange: [0, 1], outputRange: [0.6, 2.2] });
  const ringOpacity = ring.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] });

  return (
    <View style={styles.wrap}>
      <View style={styles.badgeBox}>
        <Animated.View style={[styles.ring, { transform: [{ scale: ringScale }], opacity: ringOpacity }]} />
        <Animated.View style={[styles.badge, { transform: [{ scale: pop }] }]}>
          <Text style={styles.check}>✓</Text>
        </Animated.View>
      </View>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.sub}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 10 },
  badgeBox: { width: 92, height: 92, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  ring: { position: 'absolute', width: 92, height: 92, borderRadius: 46, borderWidth: 2, borderColor: colors.accent },
  badge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  check: { color: colors.accentInk, fontSize: 34, fontWeight: '900', lineHeight: 38 },
  title: { fontFamily: fonts.heading, fontSize: 24, color: colors.text },
  sub: { fontFamily: fonts.body, fontSize: 15, color: colors.muted, textAlign: 'center' },
});
