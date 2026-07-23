import { useEffect, useRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, fonts, gradients, statusTone, toneColor } from '../lib/theme';
import { statusLabel } from '../lib/api';

/** Einstiegs-Animation: Inhalt gleitet weich nach oben ein (gestaffelt via delay). */
export function FadeInUp({
  children,
  delay = 0,
  style,
}: {
  children: ReactNode;
  delay?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: 420,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress, delay]);
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** Ember-Hintergrund: Feuerschein von unten + Vignette an den Rändern. Kein Blur,
 *  kein Aurora — warmes, cinematisches Material, das langsam „atmet". */
export function EmberBackground() {
  const glow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 5000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 5000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    ).start();
  }, [glow]);

  const opacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] });

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {/* Grundton */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]} />
      {/* Feuerschein von unten (pulsiert dezent) */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity }]}>
        <LinearGradient
          colors={['transparent', 'rgba(255,90,31,0.14)', 'rgba(255,138,43,0.22)']}
          locations={[0.45, 0.82, 1]}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      {/* Cinematische Vignette (dunkle Ecken) */}
      <LinearGradient
        colors={['rgba(0,0,0,0.5)', 'transparent', 'transparent', 'rgba(0,0,0,0.55)']}
        locations={[0, 0.22, 0.7, 1]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

/** Matte Karte: warme Fläche + haarfeine Kante, gleitet beim Mount ein, federt beim Druck. */
export function Card({
  children,
  style,
  onPress,
  delay = 0,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  delay?: number;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const press = (to: number) =>
    Animated.spring(scale, { toValue: to, useNativeDriver: true, speed: 40, bounciness: 7 }).start();

  if (onPress) {
    return (
      <FadeInUp delay={delay}>
        <Animated.View style={{ transform: [{ scale }] }}>
          <Pressable onPress={onPress} onPressIn={() => press(0.97)} onPressOut={() => press(1)} style={[styles.card, style]}>
            {children}
          </Pressable>
        </Animated.View>
      </FadeInUp>
    );
  }
  return (
    <FadeInUp delay={delay}>
      <View style={[styles.card, style]}>{children}</View>
    </FadeInUp>
  );
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: ReturnType<typeof statusTone> }) {
  const c = toneColor(tone);
  return (
    <View style={[styles.badge, { borderColor: c + '66', backgroundColor: c + '1f' }]}>
      <Text style={[styles.badgeText, { color: c }]}>{label}</Text>
    </View>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge label={statusLabel(status)} tone={statusTone(status)} />;
}

export function Button({
  title,
  onPress,
  variant = 'ghost',
  disabled,
  loading,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  loading?: boolean;
}) {
  const isPrimary = variant === 'primary';
  const isDanger = variant === 'danger';
  const scale = useRef(new Animated.Value(1)).current;
  const press = (to: number) =>
    Animated.spring(scale, { toValue: to, useNativeDriver: true, speed: 40, bounciness: 8 }).start();

  const label = loading ? (
    <ActivityIndicator color={isPrimary ? colors.accentInk : colors.accent} />
  ) : (
    <Text
      style={[styles.buttonText, { color: isPrimary ? colors.accentInk : isDanger ? colors.danger : colors.text }]}
    >
      {title}
    </Text>
  );

  return (
    <Animated.View style={{ transform: [{ scale }], opacity: disabled || loading ? 0.45 : 1 }}>
      <Pressable
        onPress={onPress}
        disabled={disabled || loading}
        onPressIn={() => press(0.94)}
        onPressOut={() => press(1)}
      >
        {isPrimary ? (
          <LinearGradient colors={gradients.cta} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.button, styles.buttonPrimary]}>
            {label}
          </LinearGradient>
        ) : (
          <View style={[styles.button, isDanger && { borderColor: colors.danger + '66', backgroundColor: 'transparent' }]}>
            {label}
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text style={styles.muted}>{children}</Text>;
}

export function ErrorText({ children }: { children: ReactNode }) {
  return <Text style={styles.error}>{children}</Text>;
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

export const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    gap: 10,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  badge: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  badgeText: {
    fontSize: 11,
    fontFamily: fonts.bodyBold,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  button: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface2,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 96,
  },
  buttonPrimary: {
    borderWidth: 0,
    backgroundColor: 'transparent',
    shadowColor: colors.ember,
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  buttonText: {
    fontFamily: fonts.heading,
    fontSize: 14,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  muted: { color: colors.muted, fontSize: 13, fontFamily: fonts.body },
  error: { color: colors.danger, fontSize: 14, fontFamily: fonts.body },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
});
