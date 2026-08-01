/**
 * Entscheidungsarchitektur und menschliche Aufsicht (§35.3, §36.5, Regeln 24–25).
 *
 * Zwei tragende Grundsätze:
 *
 *   1. **Die Policy Engine ist autoritativ.** Deterministische Verbotsregeln laufen
 *      vor jeder Modellentscheidung; ein generatives Modell darf keine Richtlinie
 *      erfinden oder überschreiben.
 *   2. **KI entscheidet nichts endgültig, was wehtut.** Auszahlung verweigern,
 *      Gewinner festlegen, Konto dauerhaft sperren — all das braucht regelbasierte
 *      Prüfung und einen menschlich erreichbaren Rechtsbehelf.
 */

export const RiskLevel = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  PROHIBITED: 'PROHIBITED',
} as const;
export type RiskLevel = (typeof RiskLevel)[keyof typeof RiskLevel];

/** Art der Entscheidung, über die gesprochen wird. */
export const DecisionType = {
  CONTENT_PUBLISH: 'CONTENT_PUBLISH',
  CONTENT_REMOVE: 'CONTENT_REMOVE',
  CONTENT_DEMOTE: 'CONTENT_DEMOTE',
  CHALLENGE_APPROVE: 'CHALLENGE_APPROVE',
  CHALLENGE_REJECT: 'CHALLENGE_REJECT',
  PAYOUT_HOLD: 'PAYOUT_HOLD',
  PAYOUT_RELEASE: 'PAYOUT_RELEASE',
  WINNER_DETERMINATION: 'WINNER_DETERMINATION',
  ACCOUNT_SUSPEND_PERMANENT: 'ACCOUNT_SUSPEND_PERMANENT',
  ACCOUNT_WARN: 'ACCOUNT_WARN',
  FRAUD_CLASSIFICATION_SEVERE: 'FRAUD_CLASSIFICATION_SEVERE',
  APPEAL_REJECTION: 'APPEAL_REJECTION',
} as const;
export type DecisionType = (typeof DecisionType)[keyof typeof DecisionType];

/**
 * Entscheidungen mit rechtlicher oder ähnlich erheblicher Wirkung. Sie dürfen nach
 * Art. 22 DSGVO nicht ausschließlich automatisiert ergehen und verlangen hier
 * zwingend menschliche Bestätigung (§36.5).
 */
export const HUMAN_CONFIRMATION_REQUIRED: readonly DecisionType[] = [
  DecisionType.PAYOUT_HOLD,
  DecisionType.PAYOUT_RELEASE,
  DecisionType.WINNER_DETERMINATION,
  DecisionType.ACCOUNT_SUSPEND_PERMANENT,
  DecisionType.FRAUD_CLASSIFICATION_SEVERE,
  DecisionType.APPEAL_REJECTION,
];

/**
 * Entscheidungen, die KI **niemals allein auslösen oder endgültig stoppen** darf —
 * auch nicht mit menschlicher Nachkontrolle „später" (Regel 24, §39-AI-Test).
 */
export const AI_MAY_NEVER_FINALIZE: readonly DecisionType[] = [
  DecisionType.PAYOUT_HOLD,
  DecisionType.PAYOUT_RELEASE,
  DecisionType.WINNER_DETERMINATION,
  DecisionType.ACCOUNT_SUSPEND_PERMANENT,
];

export interface AiAssessment {
  readonly modelVersionId: string;
  readonly policyVersionId: string;
  readonly riskLevel: RiskLevel;
  /** 0..1 */
  readonly confidence: number;
  readonly policyCodes: readonly string[];
  readonly explanation?: string;
}

/** Ergebnis der deterministischen Policy Engine — läuft **vor** dem Modell. */
export interface PolicyVerdict {
  readonly prohibited: boolean;
  readonly policyCodes: readonly string[];
}

export const Outcome = {
  AUTO_APPROVE: 'AUTO_APPROVE',
  HUMAN_REVIEW: 'HUMAN_REVIEW',
  AUTO_BLOCK: 'AUTO_BLOCK',
} as const;
export type Outcome = (typeof Outcome)[keyof typeof Outcome];

export interface DecisionInput {
  readonly decisionType: DecisionType;
  readonly policyVerdict: PolicyVerdict;
  readonly assessments: readonly AiAssessment[];
  /** Automatische Ablehnung ist per Flag global abschaltbar (Default: aus). */
  readonly automaticRejectionEnabled?: boolean;
  /** Offene Meldung zum Ziel — erzwingt menschliche Prüfung. */
  readonly hasOpenReport?: boolean;
  /** Technische Integritätsprüfung des Mediums bestanden? */
  readonly integrityPassed?: boolean;
}

export interface DecisionResult {
  readonly outcome: Outcome;
  readonly humanConfirmationRequired: boolean;
  readonly reasonCodes: readonly string[];
  /** Modell-/Policy-Versionen, die in die Entscheidung eingingen (Nachvollziehbarkeit). */
  readonly modelVersionIds: readonly string[];
  readonly policyVersionIds: readonly string[];
}

/** Ab dieser Konfidenz gilt eine Modellaussage als belastbar genug für Automatik. */
export const AUTO_CONFIDENCE_THRESHOLD = 0.9;

/**
 * Zentrale Entscheidungsmatrix.
 *
 * Reihenfolge exakt nach §35.3: deterministische Verbotsregeln, dann Modellrisiko,
 * dann Aggregation. Fail-safe: Im Zweifel Mensch, nicht Automatik.
 */
export function decide(input: DecisionInput): DecisionResult {
  const reasons: string[] = [];
  const modelVersionIds = input.assessments.map((a) => a.modelVersionId);
  const policyVersionIds = [
    ...new Set([...input.assessments.map((a) => a.policyVersionId)]),
  ];

  const humanConfirmationRequired = HUMAN_CONFIRMATION_REQUIRED.includes(input.decisionType);

  // 1. Deterministische Policy Engine ist autoritativ.
  if (input.policyVerdict.prohibited) {
    reasons.push('POLICY_PROHIBITED', ...input.policyVerdict.policyCodes);
    // Selbst ein klares Verbot darf bei geldnahen Entscheidungen nicht automatisch
    // final werden — dort entscheidet ein Mensch.
    if (AI_MAY_NEVER_FINALIZE.includes(input.decisionType)) {
      return {
        outcome: Outcome.HUMAN_REVIEW,
        humanConfirmationRequired: true,
        reasonCodes: [...reasons, 'AI_MAY_NOT_FINALIZE'],
        modelVersionIds,
        policyVersionIds,
      };
    }
    return {
      outcome: Outcome.AUTO_BLOCK,
      humanConfirmationRequired,
      reasonCodes: reasons,
      modelVersionIds,
      policyVersionIds,
    };
  }

  // 2. Geldnahe/kontenrelevante Entscheidungen: nie automatisch.
  if (AI_MAY_NEVER_FINALIZE.includes(input.decisionType)) {
    return {
      outcome: Outcome.HUMAN_REVIEW,
      humanConfirmationRequired: true,
      reasonCodes: ['AI_MAY_NOT_FINALIZE'],
      modelVersionIds,
      policyVersionIds,
    };
  }

  // 3. Harte Review-Auslöser unabhängig vom Modell.
  if (input.hasOpenReport) reasons.push('OPEN_REPORT');
  if (input.integrityPassed === false) reasons.push('INTEGRITY_CHECK_FAILED');
  if (reasons.length > 0) {
    return {
      outcome: Outcome.HUMAN_REVIEW,
      humanConfirmationRequired,
      reasonCodes: reasons,
      modelVersionIds,
      policyVersionIds,
    };
  }

  // 4. Modellaussagen aggregieren.
  if (input.assessments.length === 0) {
    return {
      outcome: Outcome.HUMAN_REVIEW,
      humanConfirmationRequired,
      reasonCodes: ['NO_ASSESSMENT'],
      modelVersionIds,
      policyVersionIds,
    };
  }

  const levels = new Set(input.assessments.map((a) => a.riskLevel));
  const lowConfidence = input.assessments.some((a) => a.confidence < AUTO_CONFIDENCE_THRESHOLD);

  // Widersprüchliche Modelle → Mensch (§39, AI-Test).
  if (levels.size > 1) {
    return {
      outcome: Outcome.HUMAN_REVIEW,
      humanConfirmationRequired,
      reasonCodes: ['CONFLICTING_ASSESSMENTS'],
      modelVersionIds,
      policyVersionIds,
    };
  }
  if (lowConfidence) {
    return {
      outcome: Outcome.HUMAN_REVIEW,
      humanConfirmationRequired,
      reasonCodes: ['LOW_CONFIDENCE'],
      modelVersionIds,
      policyVersionIds,
    };
  }

  const level = input.assessments[0]?.riskLevel ?? RiskLevel.MEDIUM;
  if (level === RiskLevel.PROHIBITED || level === RiskLevel.HIGH) {
    // Automatische Ablehnung nur, wenn ausdrücklich freigeschaltet (Default: aus).
    if (input.automaticRejectionEnabled !== true) {
      return {
        outcome: Outcome.HUMAN_REVIEW,
        humanConfirmationRequired,
        reasonCodes: ['AUTOMATIC_REJECTION_DISABLED'],
        modelVersionIds,
        policyVersionIds,
      };
    }
    return {
      outcome: Outcome.AUTO_BLOCK,
      humanConfirmationRequired,
      reasonCodes: ['HIGH_RISK_CONTENT'],
      modelVersionIds,
      policyVersionIds,
    };
  }
  if (level === RiskLevel.MEDIUM) {
    return {
      outcome: Outcome.HUMAN_REVIEW,
      humanConfirmationRequired,
      reasonCodes: ['MEDIUM_RISK_REQUIRES_REVIEW'],
      modelVersionIds,
      policyVersionIds,
    };
  }

  return {
    outcome: Outcome.AUTO_APPROVE,
    humanConfirmationRequired,
    reasonCodes: ['LOW_RISK'],
    modelVersionIds,
    policyVersionIds,
  };
}

/* ---------------------------- Reason Statements ---------------------------- */

/**
 * Begründung nach DSA-Logik (Regel 25, §33.2): Jede belastende Entscheidung nennt
 * Fakten, Policy-Bezug, ob automatisierte Mittel im Spiel waren, und den Rechtsbehelf.
 * Sicherheitskritische Details, die eine Umgehung erleichtern, gehören nicht hinein.
 */
export interface ReasonStatement {
  readonly decisionType: DecisionType;
  readonly targetType: string;
  readonly targetId: string;
  readonly policyReferences: readonly string[];
  readonly automatedMeansUsed: boolean;
  readonly humanReviewUsed: boolean;
  readonly userFacingText: string;
  readonly redressOptions: readonly string[];
  readonly modelVersionIds: readonly string[];
  readonly policyVersionIds: readonly string[];
  readonly createdAt: Date;
}

export function buildReasonStatement(params: {
  readonly decisionType: DecisionType;
  readonly targetType: string;
  readonly targetId: string;
  readonly result: DecisionResult;
  readonly userFacingText: string;
  readonly humanReviewUsed: boolean;
  readonly now?: Date;
}): ReasonStatement {
  return {
    decisionType: params.decisionType,
    targetType: params.targetType,
    targetId: params.targetId,
    policyReferences: params.result.reasonCodes,
    automatedMeansUsed: params.result.modelVersionIds.length > 0,
    humanReviewUsed: params.humanReviewUsed,
    userFacingText: params.userFacingText,
    // Der Einspruchsweg ist kostenlos und immer vorhanden (§33.2, DSA).
    redressOptions: ['INTERNAL_APPEAL', 'HUMAN_CONTACT'],
    modelVersionIds: params.result.modelVersionIds,
    policyVersionIds: params.result.policyVersionIds,
    createdAt: params.now ?? new Date(),
  };
}
