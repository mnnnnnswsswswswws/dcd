/**
 * Stop-the-Line-Bedingungen (§40).
 *
 * Geschäftserfolg wird nur zusammen mit Schutzmetriken bewertet. Tritt eine dieser
 * Bedingungen ein, wird ein Rollout automatisch gestoppt — es handelt sich um
 * Zustände, die das Produkt rechtlich, finanziell oder sicherheitstechnisch
 * unhaltbar machen. Keine dieser Bedingungen ist per Flag abschaltbar.
 */

export const StopTheLineCondition = {
  /** Ein Preisgeld wurde mehr als einmal transferiert. */
  DOUBLE_PAYOUT: 'DOUBLE_PAYOUT',
  /** Die Zehn-Plätze-Grenze wurde durchbrochen. */
  ELEVENTH_SLOT_RESERVED: 'ELEVENTH_SLOT_RESERVED',
  /** Einem Teilnehmer wurde ein Betrag für die Teilnahme berechnet. */
  PARTICIPANT_ENTRY_FEE_CHARGED: 'PARTICIPANT_ENTRY_FEE_CHARGED',
  /** Ein Gewinner wurde zufällig bestimmt. */
  RANDOM_WINNER_SELECTED: 'RANDOM_WINNER_SELECTED',
  /** Schwerer, nicht abgefangener Sicherheitsvorfall im Content. */
  SEVERE_SAFETY_INCIDENT: 'SEVERE_SAFETY_INCIDENT',
  /** Auszahlung gesperrt, ohne dass eine Begründung erzeugt wurde. */
  PAYOUT_HOLD_WITHOUT_REASON: 'PAYOUT_HOLD_WITHOUT_REASON',
  /** Der Einspruchsweg funktioniert nicht. */
  APPEAL_PATH_BROKEN: 'APPEAL_PATH_BROKEN',
  /** Ein Minderjähriger hatte Zugang zu Echtgeldfunktionen. */
  MINOR_REAL_MONEY_ACCESS: 'MINOR_REAL_MONEY_ACCESS',
  /** Kritisches Datenleck. */
  CRITICAL_DATA_BREACH: 'CRITICAL_DATA_BREACH',
  /** Ein KI-Modell wurde ohne registrierte Version eingesetzt. */
  AI_MODEL_WITHOUT_REGISTERED_VERSION: 'AI_MODEL_WITHOUT_REGISTERED_VERSION',
  /** Erheblicher Modell-Drift gegenüber der freigegebenen Evaluation. */
  SIGNIFICANT_MODEL_DRIFT: 'SIGNIFICANT_MODEL_DRIFT',
} as const;
export type StopTheLineCondition =
  (typeof StopTheLineCondition)[keyof typeof StopTheLineCondition];

export interface StopTheLineSignal {
  readonly condition: StopTheLineCondition;
  readonly detectedAt: Date;
  readonly context?: Readonly<Record<string, unknown>>;
}

export interface RolloutDecision {
  readonly halted: boolean;
  readonly conditions: readonly StopTheLineCondition[];
  readonly message: string;
}

/**
 * Wertet offene Signale aus. Ein einziges genügt, um den Rollout zu stoppen — diese
 * Bedingungen werden nicht gegeneinander abgewogen.
 */
export function evaluateRollout(
  signals: readonly StopTheLineSignal[],
): RolloutDecision {
  if (signals.length === 0) {
    return { halted: false, conditions: [], message: 'Keine Stop-the-Line-Bedingung offen.' };
  }
  const conditions = [...new Set(signals.map((s) => s.condition))];
  return {
    halted: true,
    conditions,
    message: `Rollout gestoppt: ${conditions.join(', ')}`,
  };
}
