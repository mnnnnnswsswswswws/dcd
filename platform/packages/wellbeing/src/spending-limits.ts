/**
 * Ausgabenschutz für Challenge-Ersteller (§34.3).
 *
 * Ersteller geben echtes Geld aus und brauchen daher Schutz vor Eskalation. Die
 * Grenzwerte sind **Produktstandard**, keine behaupteten gesetzlichen Schwellen.
 *
 * Zwei asymmetrische Kernregeln (bewusst nicht symmetrisch, weil Schutz sofort
 * greifen und Lockerung entschleunigt sein muss):
 *   • Senkung eines Limits wirkt **sofort**.
 *   • Erhöhung wirkt erst nach einer **Abkühlfrist von mindestens 24 Stunden**.
 */

/** Beträge durchgängig als Integer in Cent (Minor Units). */
export const MIN_PRIZE_MINOR = 500; // 5,00 €
export const MAX_PRIZE_CLOSED_BETA_MINOR = 10_000; // 100,00 € je Challenge

export const DEFAULT_LIMITS_MINOR = {
  DAILY: 10_000, // 100,00 €
  WEEKLY: 25_000, // 250,00 €
  MONTHLY: 50_000, // 500,00 €
} as const;

export const LimitType = {
  DAILY: 'DAILY',
  WEEKLY: 'WEEKLY',
  MONTHLY: 'MONTHLY',
} as const;
export type LimitType = (typeof LimitType)[keyof typeof LimitType];

/** Mindest-Abkühlfrist für Limit-Erhöhungen (§34.3). */
export const LIMIT_INCREASE_COOL_OFF_MS = 24 * 60 * 60 * 1000;

export interface SpendingLimit {
  readonly limitType: LimitType;
  readonly amountMinor: number;
  readonly effectiveAt: Date;
  /** Beantragte Erhöhung, die erst ab `increaseEffectiveAt` gilt. */
  readonly increaseRequestedAmountMinor?: number;
  readonly increaseEffectiveAt?: Date;
}

/**
 * Das aktuell **wirksame** Limit. Eine beantragte Erhöhung zählt erst, wenn ihre
 * Abkühlfrist abgelaufen ist — vorher gilt weiter der niedrigere Betrag.
 */
export function effectiveLimitMinor(limit: SpendingLimit, now: Date = new Date()): number {
  if (
    limit.increaseRequestedAmountMinor !== undefined &&
    limit.increaseEffectiveAt !== undefined &&
    limit.increaseEffectiveAt.getTime() <= now.getTime()
  ) {
    return limit.increaseRequestedAmountMinor;
  }
  return limit.amountMinor;
}

export type LimitChangeResult =
  | { readonly kind: 'APPLIED_IMMEDIATELY'; readonly limit: SpendingLimit }
  | { readonly kind: 'SCHEDULED'; readonly limit: SpendingLimit; readonly effectiveAt: Date };

/**
 * Ändert ein Limit. Senkung greift sofort und verwirft eine noch nicht wirksame
 * Erhöhung; Erhöhung wird lediglich terminiert.
 */
export function requestLimitChange(
  current: SpendingLimit,
  nextAmountMinor: number,
  now: Date = new Date(),
  coolOffMs: number = LIMIT_INCREASE_COOL_OFF_MS,
): LimitChangeResult {
  const active = effectiveLimitMinor(current, now);

  if (nextAmountMinor <= active) {
    // Senkung: sofort wirksam, offene Erhöhung fällt weg.
    return {
      kind: 'APPLIED_IMMEDIATELY',
      limit: {
        limitType: current.limitType,
        amountMinor: nextAmountMinor,
        effectiveAt: now,
      },
    };
  }

  const effectiveAt = new Date(now.getTime() + coolOffMs);
  return {
    kind: 'SCHEDULED',
    effectiveAt,
    limit: {
      ...current,
      amountMinor: active,
      increaseRequestedAmountMinor: nextAmountMinor,
      increaseEffectiveAt: effectiveAt,
    },
  };
}

export interface SpendingWindow {
  /** Bereits ausgegeben im jeweiligen Zeitfenster, in Cent. */
  readonly spentMinor: number;
  readonly limit: SpendingLimit;
}

export type SpendingDecision =
  | { readonly allowed: true; readonly remainingMinor: number }
  | {
      readonly allowed: false;
      readonly reasonCode: 'LIMIT_EXCEEDED' | 'PRIZE_BELOW_MINIMUM' | 'PRIZE_ABOVE_MAXIMUM';
      readonly limitType?: LimitType;
      readonly message: string;
    };

/**
 * Kernentscheidung vor jeder Finanzierung: Passt der Betrag in **alle** Fenster?
 *
 * Der Aufrufer muss diese Prüfung innerhalb derselben Datenbanktransaktion
 * ausführen, in der die Ausgabe verbucht wird — sonst umgehen parallele Zahlungen
 * das Limit (§39, Wellbeing-Test „parallele Payments umgehen Limit nicht").
 */
export function evaluateSpending(
  amountMinor: number,
  windows: readonly SpendingWindow[],
  now: Date = new Date(),
  maxPrizeMinor: number = MAX_PRIZE_CLOSED_BETA_MINOR,
): SpendingDecision {
  if (amountMinor < MIN_PRIZE_MINOR) {
    return {
      allowed: false,
      reasonCode: 'PRIZE_BELOW_MINIMUM',
      message: `Das Preisgeld muss mindestens ${(MIN_PRIZE_MINOR / 100).toFixed(2)} € betragen.`,
    };
  }
  if (amountMinor > maxPrizeMinor) {
    return {
      allowed: false,
      reasonCode: 'PRIZE_ABOVE_MAXIMUM',
      message: `Das Preisgeld darf derzeit höchstens ${(maxPrizeMinor / 100).toFixed(2)} € betragen.`,
    };
  }

  let tightestRemaining = Number.POSITIVE_INFINITY;
  for (const w of windows) {
    const limit = effectiveLimitMinor(w.limit, now);
    const remaining = limit - w.spentMinor;
    if (amountMinor > remaining) {
      return {
        allowed: false,
        reasonCode: 'LIMIT_EXCEEDED',
        limitType: w.limit.limitType,
        message: 'Diese Zahlung überschreitet dein selbst gesetztes Ausgabenlimit.',
      };
    }
    tightestRemaining = Math.min(tightestRemaining, remaining - amountMinor);
  }

  return {
    allowed: true,
    remainingMinor: tightestRemaining === Number.POSITIVE_INFINITY ? 0 : tightestRemaining,
  };
}
