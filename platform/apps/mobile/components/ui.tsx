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
import { BlurView } from 'expo-blur';
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

/** Animierter Aurora-Hintergrund: zwei weiche Farbwolken (Lila/Cyan), die langsam
 *  driften — darüber ein starker Blur, der sie zu Licht verschmilzt. */
export function Aurora() {
  const drift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(drift, { toValue: 1, duration: 14000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(drift, { toValue: 0, duration: 14000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    ).start();
  }, [drift]);

  const a = drift.interpolate({ inputRange: [0, 1], outputRange: [0, 70] });
  const b = drift.interpolate({ inputRange: [0, 1], outputRange: [0, -60] });

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View style={[styles.blob, styles.blobViolet, { transform: [{ translateX: a }, { translateY: a }] }]} />
      <Animated.View style={[styles.blob, styles.blobCyan, { transform: [{ translateX: b }, { translateY: b }] }]} />
      <BlurView intensity={90} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
    </View>
  );
}

/** Glas-Karte: Transluzenz + helle Kante, gleitet beim Mount ein, federt beim Druck. */
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
    backgroundColor: colors.glass,
    borderColor: colors.glassBorder,
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    gap: 10,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  badge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  badgeText: { fontSize: 12, fontFamily: fonts.bodySemibold },
  button: {
    borderWidth: 1,
    borderColor: colors.glassBorder,
    backgroundColor: colors.surface2,
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 96,
  },
  buttonPrimary: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    backgroundColor: 'transparent',
    shadowColor: '#7c4dff',
    shadowOpacity: 0.5,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  buttonText: { fontFamily: fonts.heading, fontSize: 15 },
  muted: { color: colors.muted, fontSize: 13, fontFamily: fonts.body },
  error: { color: colors.danger, fontSize: 14, fontFamily: fonts.body },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  blob: {
    position: 'absolute',
    width: 420,
    height: 420,
    borderRadius: 210,
    opacity: 0.55,
  },
  blobViolet: {
    backgroundColor: 'rgba(124,77,255,0.55)',
    top: -140,
    left: -120,
  },
  blobCyan: {
    backgroundColor: 'rgba(34,211,238,0.35)',
    bottom: -160,
    right: -120,
  },
});
