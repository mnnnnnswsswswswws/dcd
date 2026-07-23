/** HapticFeedbackService — gezielte Haptik an genau definierten Zustandswechseln,
 *  nie flächig. Kapselt expo-haptics; auf Web/Server ein sicherer No-op.
 *  Politik siehe docs/design/MOTION_SYSTEM.md. */
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

const enabled = Platform.OS === 'ios' || Platform.OS === 'android';

function safe(run: () => Promise<unknown>): void {
  if (!enabled) return;
  run().catch(() => {
    /* Haptik ist nie kritisch */
  });
}

export const haptics = {
  /** Auswahl/Tap wichtiger Aktionen (Interesse, Speichern-Toggle). */
  selection: () => safe(() => Haptics.selectionAsync()),
  /** Öffnen, Long-Press-Vorschau. */
  light: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  /** Aufnahme Start/Stop, Countdown-Tick. */
  medium: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  /** Einsendung erfolgreich, Gewinn. */
  success: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  /** Fehler. */
  error: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};
