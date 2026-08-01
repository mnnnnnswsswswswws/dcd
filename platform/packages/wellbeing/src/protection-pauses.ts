/**
 * Schutzpausen und Selbstausschluss (§34.6).
 *
 * Leitgedanke: Schutz greift sofort, Lockerung ist entschleunigt. Eine 7- oder
 * 30-Tage-Pause ist **nicht** vorzeitig aufhebbar; eine unbefristete Pause erst nach
 * mindestens sieben Tagen Abkühlung und bewusster Bestätigung. Support darf zur
 * Aufhebung nicht drängen (organisatorische Regel, hier technisch flankiert).
 */

/** Was die Pause umfasst. */
export const PauseScope = {
  /** Geldfunktionen pausieren: keine Challenge finanzieren/erstellen. */
  MONEY: 'MONEY',
  /** Teilnahmen pausieren. */
  PARTICIPATION: 'PARTICIPATION',
  /** Benachrichtigungen pausieren. */
  NOTIFICATIONS: 'NOTIFICATIONS',
  /** Komplette Schutzpause. */
  FULL: 'FULL',
} as const;
export type PauseScope = (typeof PauseScope)[keyof typeof PauseScope];

export const PauseDuration = {
  HOURS_24: 'HOURS_24',
  DAYS_7: 'DAYS_7',
  DAYS_30: 'DAYS_30',
  INDEFINITE: 'INDEFINITE',
} as const;
export type PauseDuration = (typeof PauseDuration)[keyof typeof PauseDuration];

const DURATION_MS: Record<Exclude<PauseDuration, 'INDEFINITE'>, number> = {
  HOURS_24: 24 * 60 * 60 * 1000,
  DAYS_7: 7 * 24 * 60 * 60 * 1000,
  DAYS_30: 30 * 24 * 60 * 60 * 1000,
};

/** Abkühlzeit, bevor eine unbefristete Pause überhaupt aufhebbar wird. */
export const INDEFINITE_REVOCATION_COOL_OFF_MS = 7 * 24 * 60 * 60 * 1000;

export interface ProtectionPause {
  readonly scope: PauseScope;
  readonly startsAt: Date;
  /** Nur bei befristeten Pausen gesetzt. */
  readonly endsAt?: Date;
  readonly indefinite: boolean;
  /** Frühestens ab hier darf eine Aufhebung beantragt werden (nur unbefristet). */
  readonly revocationEligibleAt?: Date;
}

/** Legt eine Pause an. Sie gilt ab sofort. */
export function startPause(
  scope: PauseScope,
  duration: PauseDuration,
  now: Date = new Date(),
): ProtectionPause {
  if (duration === PauseDuration.INDEFINITE) {
    return {
      scope,
      startsAt: now,
      indefinite: true,
      revocationEligibleAt: new Date(now.getTime() + INDEFINITE_REVOCATION_COOL_OFF_MS),
    };
  }
  return {
    scope,
    startsAt: now,
    endsAt: new Date(now.getTime() + DURATION_MS[duration]),
    indefinite: false,
  };
}

export function isPauseActive(pause: ProtectionPause, now: Date = new Date()): boolean {
  if (now.getTime() < pause.startsAt.getTime()) return false;
  if (pause.indefinite) return true;
  return pause.endsAt !== undefined && now.getTime() < pause.endsAt.getTime();
}

export type RevocationResult =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reasonCode: 'FIXED_TERM_NOT_REVOCABLE' | 'COOL_OFF_ACTIVE' | 'NOT_ACTIVE';
      readonly message: string;
      readonly eligibleAt?: Date;
    };

/**
 * Darf die Pause jetzt aufgehoben werden? Befristete Pausen laufen aus, sie werden
 * nicht widerrufen — nur die 24-Stunden-Variante ist bewusst kurz genug, dass ein
 * Widerruf keinen Schutz aushebelt.
 */
export function canRevokePause(
  pause: ProtectionPause,
  duration: PauseDuration,
  now: Date = new Date(),
): RevocationResult {
  if (!isPauseActive(pause, now)) {
    return { allowed: false, reasonCode: 'NOT_ACTIVE', message: 'Es ist keine Pause aktiv.' };
  }
  if (!pause.indefinite) {
    if (duration === PauseDuration.HOURS_24) return { allowed: true };
    return {
      allowed: false,
      reasonCode: 'FIXED_TERM_NOT_REVOCABLE',
      message: 'Diese Schutzpause kann nicht vorzeitig aufgehoben werden.',
      eligibleAt: pause.endsAt,
    };
  }
  if (pause.revocationEligibleAt && now.getTime() < pause.revocationEligibleAt.getTime()) {
    return {
      allowed: false,
      reasonCode: 'COOL_OFF_ACTIVE',
      message: 'Eine Aufhebung ist erst nach der Abkühlzeit möglich.',
      eligibleAt: pause.revocationEligibleAt,
    };
  }
  return { allowed: true };
}

/** Aktionen, die eine Pause blockiert. */
export const GuardedAction = {
  FUND_CHALLENGE: 'FUND_CHALLENGE',
  CREATE_MONEY_CHALLENGE: 'CREATE_MONEY_CHALLENGE',
  JOIN_MONEY_CHALLENGE: 'JOIN_MONEY_CHALLENGE',
  RECEIVE_MARKETING_PUSH: 'RECEIVE_MARKETING_PUSH',
  /** Bestehende Auszahlungsansprüche bleiben immer zugänglich. */
  CLAIM_EXISTING_PAYOUT: 'CLAIM_EXISTING_PAYOUT',
} as const;
export type GuardedAction = (typeof GuardedAction)[keyof typeof GuardedAction];

const BLOCKED_BY_SCOPE: Record<PauseScope, readonly GuardedAction[]> = {
  [PauseScope.MONEY]: [GuardedAction.FUND_CHALLENGE, GuardedAction.CREATE_MONEY_CHALLENGE],
  [PauseScope.PARTICIPATION]: [GuardedAction.JOIN_MONEY_CHALLENGE],
  [PauseScope.NOTIFICATIONS]: [GuardedAction.RECEIVE_MARKETING_PUSH],
  [PauseScope.FULL]: [
    GuardedAction.FUND_CHALLENGE,
    GuardedAction.CREATE_MONEY_CHALLENGE,
    GuardedAction.JOIN_MONEY_CHALLENGE,
    GuardedAction.RECEIVE_MARKETING_PUSH,
  ],
};

/**
 * Blockiert eine aktive Pause diese Aktion? Auszahlungsansprüche sind bewusst nie
 * blockiert — ein Selbstschutz darf niemandem sein bereits verdientes Geld entziehen.
 */
export function isActionBlocked(
  pauses: readonly ProtectionPause[],
  action: GuardedAction,
  now: Date = new Date(),
): boolean {
  if (action === GuardedAction.CLAIM_EXISTING_PAYOUT) return false;
  return pauses.some(
    (p) => isPauseActive(p, now) && BLOCKED_BY_SCOPE[p.scope].includes(action),
  );
}
