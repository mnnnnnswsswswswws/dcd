import { useRef, type ReactNode } from 'react';
import { Animated, Pressable, type StyleProp, type ViewStyle } from 'react-native';
import { scale, springs, springTo } from '../../lib/motion';
import { haptics } from '../../lib/haptics';

/** Einheitliche gedrückte Fläche: Feder-Scale + gezielte Haptik. Ersetzt verteilte
 *  Einzel-Press-Logik. Deckt default/pressed/disabled ab. */
export function AnimatedPressable({
  children,
  onPress,
  onLongPress,
  disabled,
  haptic = 'selection',
  pressScale = scale.press,
  style,
  hitSlop = 6,
}: {
  children: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  haptic?: 'selection' | 'light' | 'medium' | 'none';
  pressScale?: number;
  style?: StyleProp<ViewStyle>;
  hitSlop?: number;
}) {
  const s = useRef(new Animated.Value(1)).current;

  return (
    <Pressable
      disabled={disabled}
      hitSlop={hitSlop}
      onPressIn={() => springTo(s, pressScale, springs.press).start()}
      onPressOut={() => springTo(s, 1, springs.press).start()}
      onPress={() => {
        if (haptic !== 'none') haptics[haptic]();
        onPress?.();
      }}
      onLongPress={
        onLongPress
          ? () => {
              haptics.light();
              onLongPress();
            }
          : undefined
      }
      delayLongPress={350}
    >
      <Animated.View style={[{ transform: [{ scale: s }], opacity: disabled ? 0.45 : 1 }, style]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
