import { useEffect, useRef, useState } from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { dur, eases, prefersReducedMotion } from '../../lib/motion';

/** Zählt weich auf einen Zielwert (Preisgeld, Teilnehmer). Zweck: Feedback +
 *  Statusanzeige — der Wert „baut sich auf", statt hart zu erscheinen. */
export function AnimatedCounter({
  value,
  format = (n) => String(n),
  duration = 900,
  style,
}: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
  style?: StyleProp<TextStyle>;
}) {
  const [shown, setShown] = useState(prefersReducedMotion() ? value : 0);
  const from = useRef(0);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setShown(value);
      return;
    }
    const start = Date.now();
    const startVal = from.current;
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / duration);
      const eased = eases.out(t);
      const cur = Math.round(startVal + (value - startVal) * eased);
      setShown(cur);
      if (t < 1) {
        raf.current = requestAnimationFrame(tick);
      } else {
        from.current = value;
      }
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  return <Text style={style}>{format(shown)}</Text>;
}

// dur nur re-exportiert, damit Aufrufer konsistente Dauern nutzen können.
export { dur };
