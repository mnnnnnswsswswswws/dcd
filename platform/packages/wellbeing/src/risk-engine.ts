/**
 * Wellbeing Risk Engine (§34.7) sowie Zeit-/Teilnahmeschutz (§34.4, §34.5).
 *
 * Zweck ist **Prävention, keine medizinische Diagnose**. Die Engine darf niemanden
 * als „süchtig" klassifizieren, kein Gesundheitsprofil für Werbung erzeugen und den
 * Risikoscore nicht öffentlich machen. Interventionen werden nie durch Bonusangebote
 * ersetzt.
 */

export const InterventionLevel = {
  LEVEL_0_NORMAL: 'LEVEL_0_NORMAL',
  LEVEL_1_INFORMATION: 'LEVEL_1_INFORMATION',
  LEVEL_2_FRICTION: 'LEVEL_2_FRICTION',
  LEVEL_3_COOL_OFF_RECOMMENDED: 'LEVEL_3_COOL_OFF_RECOMMENDED',
  LEVEL_4_TEMPORARY_MONEY_HOLD: 'LEVEL_4_TEMPORARY_MONEY_HOLD',
} as const;
export type InterventionLevel = (typeof InterventionLevel)[keyof typeof InterventionLevel];

/** Beobachtbare, zweckgebundene Signale — bewusst datensparsam. */
export const RiskSignal = {
  SPENDING_SPIKE: 'SPENDING_SPIKE',
  RAPID_REPEAT_PAYMENTS: 'RAPID_REPEAT_PAYMENTS',
  REPEATED_LIMIT_INCREASE_ATTEMPTS: 'REPEATED_LIMIT_INCREASE_ATTEMPTS',
  LATE_NIGHT_MONEY_ACTIVITY: 'LATE_NIGHT_MONEY_ACTIVITY',
  VERY_LONG_SESSION: 'VERY_LONG_SESSION',
  RAPID_CONSECUTIVE_LOSSES: 'RAPID_CONSECUTIVE_LOSSES',
  REPEATED_SIMILAR_FUNDING: 'REPEATED_SIMILAR_FUNDING',
  UNUSUAL_PUSH_REACTIVITY: 'UNUSUAL_PUSH_REACTIVITY',
  FREQUENT_REFUND_OR_CHARGEBACK: 'FREQUENT_REFUND_OR_CHARGEBACK',
} as const;
export type RiskSignal = (typeof RiskSignal)[keyof typeof RiskSignal];

/**
 * Signale mit besonderem Gewicht: Sie deuten auf Kontrollverlust rund um Geld hin
 * und führen schneller zu Reibung statt bloßer Information.
 */
const HEAVY_SIGNALS: readonly RiskSignal[] = [
  RiskSignal.SPENDING_SPIKE,
  RiskSignal.RAPID_REPEAT_PAYMENTS,
  RiskSignal.REPEATED_LIMIT_INCREASE_ATTEMPTS,
  RiskSignal.FREQUENT_REFUND_OR_CHARGEBACK,
];

export interface InterventionDecision {
  readonly level: InterventionLevel;
  readonly triggerCodes: readonly RiskSignal[];
  /** Zusätzliche Reibung im Checkout (keine Ein-Klick-Wiederholung). */
  readonly requiresExtraConfirmation: boolean;
  /** Limit-Erhöhungen sind ab Stufe 3 gesperrt. */
  readonly limitIncreaseBlocked: boolean;
  /** Neue Finanzierungen temporär gesperrt; menschliche Prüfung nötig. */
  readonly moneyHold: boolean;
  readonly humanReviewRequired: boolean;
}

/**
 * Stufenlogik: Menge und Gewicht der Signale bestimmen die Intervention. Bewusst
 * einfach und erklärbar — eine undurchsichtige Score-Blackbox wäre hier das falsche
 * Werkzeug, weil die Folgen den Nutzer direkt einschränken.
 */
export function evaluateIntervention(
  signals: readonly RiskSignal[],
): InterventionDecision {
  const unique = [...new Set(signals)];
  const heavy = unique.filter((s) => HEAVY_SIGNALS.includes(s)).length;

  let level: InterventionLevel = InterventionLevel.LEVEL_0_NORMAL;
  if (unique.length === 0) {
    level = InterventionLevel.LEVEL_0_NORMAL;
  } else if (heavy >= 3 || unique.length >= 5) {
    level = InterventionLevel.LEVEL_4_TEMPORARY_MONEY_HOLD;
  } else if (heavy >= 2 || unique.length >= 4) {
    level = InterventionLevel.LEVEL_3_COOL_OFF_RECOMMENDED;
  } else if (heavy >= 1 || unique.length >= 2) {
    level = InterventionLevel.LEVEL_2_FRICTION;
  } else {
    level = InterventionLevel.LEVEL_1_INFORMATION;
  }

  return {
    level,
    triggerCodes: unique,
    requiresExtraConfirmation:
      level === InterventionLevel.LEVEL_2_FRICTION ||
      level === InterventionLevel.LEVEL_3_COOL_OFF_RECOMMENDED,
    limitIncreaseBlocked:
      level === InterventionLevel.LEVEL_3_COOL_OFF_RECOMMENDED ||
      level === InterventionLevel.LEVEL_4_TEMPORARY_MONEY_HOLD,
    moneyHold: level === InterventionLevel.LEVEL_4_TEMPORARY_MONEY_HOLD,
    humanReviewRequired: level === InterventionLevel.LEVEL_4_TEMPORARY_MONEY_HOLD,
  };
}

/* ----------------------------- Nutzungszeit ----------------------------- */

/** Neutraler Zeit-Hinweis nach 20 Minuten, stärkere Unterbrechung nach 45 (§34.5). */
export const TIME_NOTICE_MINUTES = 20;
export const TIME_INTERRUPT_MINUTES = 45;

export const TimeNotice = {
  NONE: 'NONE',
  GENTLE: 'GENTLE',
  INTERRUPT: 'INTERRUPT',
} as const;
export type TimeNotice = (typeof TimeNotice)[keyof typeof TimeNotice];

export function evaluateSessionTime(continuousMinutes: number): TimeNotice {
  if (continuousMinutes >= TIME_INTERRUPT_MINUTES) return TimeNotice.INTERRUPT;
  if (continuousMinutes >= TIME_NOTICE_MINUTES) return TimeNotice.GENTLE;
  return TimeNotice.NONE;
}

/* ------------------------------ Ruhezeiten ------------------------------ */

/** Standard-Ruhezeit für Push-Nachrichten in lokaler Zeit (§34.5). */
export const DEFAULT_QUIET_HOURS = { startHour: 22, endHour: 8 } as const;

/**
 * Liegt die lokale Stunde in der Ruhezeit? Das Fenster überschreitet Mitternacht,
 * daher die Oder-Verknüpfung.
 */
export function isQuietHour(
  localHour: number,
  quiet: { startHour: number; endHour: number } = DEFAULT_QUIET_HOURS,
): boolean {
  if (quiet.startHour === quiet.endHour) return false;
  if (quiet.startHour < quiet.endHour) {
    return localHour >= quiet.startHour && localHour < quiet.endHour;
  }
  return localHour >= quiet.startHour || localHour < quiet.endHour;
}

/** Push-Kategorien. Finanz-/Marketing-Pushes sind in Ruhezeiten unzulässig. */
export const PushCategory = {
  MARKETING: 'MARKETING',
  FINANCIAL: 'FINANCIAL',
  /** Transaktional und vom Nutzer erwartet, z. B. „Reservierung läuft ab". */
  TRANSACTIONAL: 'TRANSACTIONAL',
  SAFETY: 'SAFETY',
} as const;
export type PushCategory = (typeof PushCategory)[keyof typeof PushCategory];

/**
 * Darf dieser Push jetzt raus?
 *
 * • SAFETY geht immer — Gefahrenhinweise dürfen nicht unterdrückt werden.
 * • Eine Benachrichtigungspause blockiert alles Übrige.
 * • In Ruhezeiten sind MARKETING und FINANCIAL gesperrt (§34.5: keine finanziellen
 *   Push-Nachrichten in Ruhezeiten, kein nächtlicher Geld-/Reaktivierungsdruck).
 *   TRANSACTIONAL bleibt zulässig, weil es sich um vom Nutzer selbst ausgelöste,
 *   zeitkritische Vorgänge handelt — etwa eine ablaufende Reservierung.
 */
export function maySendPush(
  category: PushCategory,
  localHour: number,
  opts: { readonly notificationsPaused?: boolean } = {},
): boolean {
  if (category === PushCategory.SAFETY) return true;
  if (opts.notificationsPaused) return false;
  if (isQuietHour(localHour)) {
    return category === PushCategory.TRANSACTIONAL;
  }
  return true;
}

/* --------------------------- Teilnehmerschutz --------------------------- */

/** Höchstens drei gleichzeitig aktive Reservierungen plattformweit (§34.4, §7). */
export const MAX_ACTIVE_RESERVATIONS = 3;
/** Höchstens fünf abgeschlossene Echtgeldteilnahmen pro Tag im MVP (§34.4). */
export const MAX_DAILY_PARTICIPATIONS = 5;

export type ParticipationDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reasonCode: 'TOO_MANY_ACTIVE_RESERVATIONS' | 'DAILY_PARTICIPATION_LIMIT';
      readonly message: string;
    };

export function evaluateParticipation(counts: {
  readonly activeReservations: number;
  readonly participationsToday: number;
}): ParticipationDecision {
  if (counts.activeReservations >= MAX_ACTIVE_RESERVATIONS) {
    return {
      allowed: false,
      reasonCode: 'TOO_MANY_ACTIVE_RESERVATIONS',
      message: `Du kannst höchstens ${MAX_ACTIVE_RESERVATIONS} Plätze gleichzeitig reservieren.`,
    };
  }
  if (counts.participationsToday >= MAX_DAILY_PARTICIPATIONS) {
    return {
      allowed: false,
      reasonCode: 'DAILY_PARTICIPATION_LIMIT',
      message: 'Du hast heute bereits die maximale Anzahl an Teilnahmen erreicht.',
    };
  }
  return { allowed: true };
}
