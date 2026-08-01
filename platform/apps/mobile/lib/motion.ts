/** Motion-Tokens — die einzige Quelle für Dauer, Federn und Eases. Keine
 *  Einzelanimation streut eigene Magic-Numbers; alles referenziert diese Tokens.
 *  Siehe docs/design/MOTION_SYSTEM.md. */
import { AccessibilityInfo, Animated, Easing } from 'react-native';

export const dur = {
  tap: 110,
  move: 260,
  celebrate: 560,
} as const;

/** Verbindliche Motion-Tokens (docs/design/MOTION_SYSTEM.md, Abschnitt L).
 *  Werte nach realem Test kalibriert; keine Komponente definiert eigene Zufallswerte. */
export const motion = {
  duration: {
    instant: 80,
    fast: 140,
    normal: 220,
    deliberate: 320,
    celebration: 650,
  },
  // RN Animated.spring nutzt speed/bounciness; die damping/stiffness-Absicht ist
  // hier auf äquivalente RN-Parameter abgebildet.
  spring: {
    press: { speed: 40, bounciness: 12 },
    sheet: { speed: 14, bounciness: 4 },
    cardExpand: { speed: 12, bounciness: 8 },
  },
} as const;

export const springs = {
  press: { speed: 40, bounciness: 12 },
  enter: { speed: 12, bounciness: 9 },
  sheet: { speed: 14, bounciness: 4 },
} as const;

export const eases = {
  out: Easing.out(Easing.cubic),
  inout: Easing.inOut(Easing.sin),
} as const;

export const scale = {
  press: 0.96,
} as const;

/** Reduced-Motion-Status, einmal gelesen und gecacht; live aktualisiert. */
let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled?.()
  .then((v) => {
    reduceMotion = v;
  })
  .catch(() => {});
AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v) => {
  reduceMotion = v;
});
// Web: prefers-reduced-motion respektieren.
if (typeof window !== 'undefined' && window.matchMedia) {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  reduceMotion = reduceMotion || mq.matches;
  mq.addEventListener?.('change', (e) => {
    reduceMotion = e.matches;
  });
}
export function prefersReducedMotion(): boolean {
  return reduceMotion;
}

/** Feder auf einen Zielwert — respektiert Reduced Motion (springt dann sofort). */
export function springTo(value: Animated.Value, toValue: number, cfg = springs.press): Animated.CompositeAnimation {
  if (reduceMotion) {
    value.setValue(toValue);
    return { start: (cb?: (r: { finished: boolean }) => void) => cb?.({ finished: true }), stop: () => {}, reset: () => {} } as unknown as Animated.CompositeAnimation;
  }
  return Animated.spring(value, { toValue, useNativeDriver: true, ...cfg });
}
