/**
 * Legal Launch Gates (§33).
 *
 * Compliance ist kein nachgelagertes Dokument, sondern Domänenlogik: Jede
 * produktionsrelevante Funktion trägt einen `legal_gate_status`. Ohne
 * `APPROVED_FOR_GERMANY_LIVE` bleiben Echtgeld, öffentliche UGC-Verbreitung und
 * Auszahlungen deaktiviert — unabhängig davon, was ein Feature-Flag behauptet.
 *
 * Diese Datei ist bewusst frei von Framework- und Datenbankabhängigkeiten, damit die
 * Gate-Auswertung überall (API, Worker, Admin, Tests) identisch gilt.
 */

/** Status eines Gates. Reihenfolge = aufsteigende Freigabetiefe (BLOCKED ausgenommen). */
export const LegalGateStatus = {
  NOT_ASSESSED: 'NOT_ASSESSED',
  ASSESSMENT_REQUIRED: 'ASSESSMENT_REQUIRED',
  APPROVED_FOR_SANDBOX: 'APPROVED_FOR_SANDBOX',
  APPROVED_FOR_CLOSED_BETA: 'APPROVED_FOR_CLOSED_BETA',
  APPROVED_FOR_GERMANY_LIVE: 'APPROVED_FOR_GERMANY_LIVE',
  BLOCKED: 'BLOCKED',
  REASSESSMENT_REQUIRED: 'REASSESSMENT_REQUIRED',
} as const;
export type LegalGateStatus = (typeof LegalGateStatus)[keyof typeof LegalGateStatus];

/** Betriebsstufe, in der die Plattform gerade läuft. */
export const LaunchStage = {
  SANDBOX: 'SANDBOX',
  CLOSED_BETA: 'CLOSED_BETA',
  GERMANY_LIVE: 'GERMANY_LIVE',
} as const;
export type LaunchStage = (typeof LaunchStage)[keyof typeof LaunchStage];

/** Funktionen, die ohne passendes Gate nicht aktiv sein dürfen (§33.1). */
export const GatedFeature = {
  REAL_MONEY: 'REAL_MONEY',
  PAYOUTS: 'PAYOUTS',
  PUBLIC_FEED: 'PUBLIC_FEED',
  AI_AUTOMATIC_REJECTION: 'AI_AUTOMATIC_REJECTION',
  LONG_CAPTURE: 'LONG_CAPTURE',
  PHYSICAL_FULFILLMENT: 'PHYSICAL_FULFILLMENT',
} as const;
export type GatedFeature = (typeof GatedFeature)[keyof typeof GatedFeature];

/**
 * Welcher Gate-Status genügt für welche Stufe. `BLOCKED`, `NOT_ASSESSED`,
 * `ASSESSMENT_REQUIRED` und `REASSESSMENT_REQUIRED` genügen nie — auch nicht in der
 * Sandbox, denn ein blockiertes Feature bleibt blockiert.
 */
const STAGE_MINIMUM: Record<LaunchStage, readonly LegalGateStatus[]> = {
  [LaunchStage.SANDBOX]: [
    LegalGateStatus.APPROVED_FOR_SANDBOX,
    LegalGateStatus.APPROVED_FOR_CLOSED_BETA,
    LegalGateStatus.APPROVED_FOR_GERMANY_LIVE,
  ],
  [LaunchStage.CLOSED_BETA]: [
    LegalGateStatus.APPROVED_FOR_CLOSED_BETA,
    LegalGateStatus.APPROVED_FOR_GERMANY_LIVE,
  ],
  [LaunchStage.GERMANY_LIVE]: [LegalGateStatus.APPROVED_FOR_GERMANY_LIVE],
};

export interface LaunchGate {
  readonly jurisdiction: string;
  readonly feature: GatedFeature;
  readonly status: LegalGateStatus;
  /** Ablaufdatum der Freigabe; abgelaufene Freigaben zählen als nicht erteilt. */
  readonly expiresAt?: Date;
  readonly approvedBy?: string;
  readonly approvedAt?: Date;
}

export interface GateDecision {
  readonly allowed: boolean;
  /** Maschinenlesbarer Grund — landet in Reason Statements und Audit-Logs. */
  readonly reasonCode:
    | 'GATE_APPROVED'
    | 'GATE_MISSING'
    | 'GATE_BLOCKED'
    | 'GATE_EXPIRED'
    | 'GATE_INSUFFICIENT_FOR_STAGE'
    | 'GATE_REASSESSMENT_REQUIRED';
  readonly message: string;
}

/**
 * Kernauswertung: Darf `feature` in `stage` aktiv sein?
 *
 * Fail-closed: Fehlt das Gate, ist es abgelaufen, blockiert oder für die Stufe zu
 * schwach, lautet die Antwort nein.
 */
export function evaluateGate(
  gate: LaunchGate | undefined,
  stage: LaunchStage,
  now: Date = new Date(),
): GateDecision {
  if (!gate) {
    return {
      allowed: false,
      reasonCode: 'GATE_MISSING',
      message: 'Für diese Funktion liegt keine rechtliche Freigabe vor.',
    };
  }
  if (gate.status === LegalGateStatus.BLOCKED) {
    return {
      allowed: false,
      reasonCode: 'GATE_BLOCKED',
      message: 'Diese Funktion wurde rechtlich blockiert.',
    };
  }
  if (gate.status === LegalGateStatus.REASSESSMENT_REQUIRED) {
    return {
      allowed: false,
      reasonCode: 'GATE_REASSESSMENT_REQUIRED',
      message: 'Diese Funktion muss nach einer wesentlichen Änderung neu geprüft werden.',
    };
  }
  if (gate.expiresAt && gate.expiresAt.getTime() <= now.getTime()) {
    return {
      allowed: false,
      reasonCode: 'GATE_EXPIRED',
      message: 'Die rechtliche Freigabe für diese Funktion ist abgelaufen.',
    };
  }
  if (!STAGE_MINIMUM[stage].includes(gate.status)) {
    return {
      allowed: false,
      reasonCode: 'GATE_INSUFFICIENT_FOR_STAGE',
      message: 'Die vorliegende Freigabe reicht für diese Betriebsstufe nicht aus.',
    };
  }
  return {
    allowed: true,
    reasonCode: 'GATE_APPROVED',
    message: 'Rechtliche Freigabe liegt vor.',
  };
}

/**
 * Pflichtgutachten vor `REAL_MONEY_ENABLED=true` (§33.3). Alle zehn müssen
 * unterschrieben vorliegen — Teilmengen genügen nicht.
 */
export const REQUIRED_LIVE_ASSESSMENTS = [
  'GAMBLING_CLASSIFICATION',
  'DSA_PLATFORM_ANALYSIS',
  'DATA_PROTECTION_DPIA',
  'PAYMENT_AND_AML_REVIEW',
  'CONSUMER_CHECKOUT_REVIEW',
  'TAX_PSTTG_ANALYSIS',
  'YOUTH_PROTECTION_CONCEPT',
  'MODERATION_AND_AUTHORITY_RUNBOOK',
  'APP_STORE_CLEARANCE',
  'INSURANCE_REVIEW',
] as const;
export type RequiredLiveAssessment = (typeof REQUIRED_LIVE_ASSESSMENTS)[number];

export interface LiveReadiness {
  readonly ready: boolean;
  readonly missing: readonly RequiredLiveAssessment[];
}

/** Prüft, ob alle Pflichtgutachten für den Echtgeldstart vorliegen. */
export function evaluateLiveReadiness(
  signedAssessments: readonly string[],
): LiveReadiness {
  const signed = new Set(signedAssessments);
  const missing = REQUIRED_LIVE_ASSESSMENTS.filter((a) => !signed.has(a));
  return { ready: missing.length === 0, missing };
}

/**
 * Wesentliche Änderungen, die ein bestehendes Gate automatisch auf
 * `REASSESSMENT_REQUIRED` zurückwerfen (§33.2, Glücksspielabschnitt): Monetarisierung,
 * Voting, Punkte, Wallet oder Zufallselemente.
 */
export const MATERIAL_CHANGE_DOMAINS = [
  'MONETIZATION',
  'VOTING',
  'POINTS',
  'WALLET',
  'RANDOMNESS',
] as const;
export type MaterialChangeDomain = (typeof MATERIAL_CHANGE_DOMAINS)[number];

/**
 * Wendet eine wesentliche Änderung auf ein Gate an. Erteilte Freigaben verlieren
 * ihre Gültigkeit; bereits blockierte Gates bleiben blockiert.
 */
export function applyMaterialChange(gate: LaunchGate): LaunchGate {
  if (gate.status === LegalGateStatus.BLOCKED) return gate;
  return { ...gate, status: LegalGateStatus.REASSESSMENT_REQUIRED };
}
