import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Dimensions, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { eases, prefersReducedMotion, springs } from '../../lib/motion';
import { haptics } from '../../lib/haptics';
import { colors } from '../../lib/theme';

const H = Dimensions.get('window').height;

/** Ziehbares Bottom-Sheet: öffnet von unten, folgt dem Finger, schließt per Drag-down
 *  (>30 % oder Flick) oder Backdrop-Tap. Zweck: räumlicher Zusammenhang + Kontrolle.
 *  Reduced Motion: schneller Fade statt Translate. */
export function AnimatedBottomSheet({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const y = useRef(new Animated.Value(H)).current;
  const backdrop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (open) {
      haptics.light();
      if (prefersReducedMotion()) {
        y.setValue(0);
        backdrop.setValue(1);
      } else {
        Animated.parallel([
          Animated.spring(y, { toValue: 0, useNativeDriver: true, ...springs.sheet }),
          Animated.timing(backdrop, { toValue: 1, duration: 200, easing: eases.out, useNativeDriver: true }),
        ]).start();
      }
    } else {
      Animated.parallel([
        Animated.timing(y, { toValue: H, duration: 220, easing: eases.out, useNativeDriver: true }),
        Animated.timing(backdrop, { toValue: 0, duration: 200, easing: eases.out, useNativeDriver: true }),
      ]).start();
    }
  }, [open, y, backdrop]);

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => g.dy > 6,
      onPanResponderMove: (_e, g) => {
        if (g.dy > 0) y.setValue(g.dy);
      },
      onPanResponderRelease: (_e, g) => {
        if (g.dy > 120 || g.vy > 0.8) {
          onClose();
        } else {
          Animated.spring(y, { toValue: 0, useNativeDriver: true, ...springs.sheet }).start();
        }
      },
    }),
  ).current;

  if (!open) {
    // Nach Schließanimation aus dem Baum nehmen — aber erst wenn zu. Einfach: nicht rendern.
    return null;
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdrop }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <Animated.View style={[styles.sheet, { transform: [{ translateY: y }] }]}>
        <View {...pan.panHandlers} style={styles.grabZone}>
          <View style={styles.handle} />
        </View>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '82%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    paddingBottom: 28,
  },
  grabZone: { alignItems: 'center', paddingTop: 10, paddingBottom: 6 },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong },
});
