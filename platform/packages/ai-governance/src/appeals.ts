/**
 * Einspruchsverfahren (§37, §39 DSA-Tests).
 *
 * Kernanforderung: Ein Einspruch löst eine **neue, unabhängige** Prüfung aus. Er darf
 * nicht durch dasselbe automatisierte Ergebnis endgültig entschieden werden, das die
 * ursprüngliche Entscheidung getragen hat — sonst wäre der Rechtsbehelf wirkungslos.
 * Das Verfahren ist für den Nutzer kostenlos.
 */

import { AI_MAY_NEVER_FINALIZE, type DecisionType } from './decisions.js';

export const AppealStatus = {
  SUBMITTED: 'SUBMITTED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  UPHELD: 'UPHELD', // ursprüngliche Entscheidung bleibt
  OVERTURNED: 'OVERTURNED', // Entscheidung wird aufgehoben
  PARTIALLY_UPHELD: 'PARTIALLY_UPHELD',
  WITHDRAWN: 'WITHDRAWN',
} as const;
export type AppealStatus = (typeof AppealStatus)[keyof typeof AppealStatus];

const TRANSITIONS: Record<AppealStatus, readonly AppealStatus[]> = {
  [AppealStatus.SUBMITTED]: [AppealStatus.UNDER_REVIEW, AppealStatus.WITHDRAWN],
  [AppealStatus.UNDER_REVIEW]: [
    AppealStatus.UPHELD,
    AppealStatus.OVERTURNED,
    AppealStatus.PARTIALLY_UPHELD,
    AppealStatus.WITHDRAWN,
  ],
  [AppealStatus.UPHELD]: [],
  [AppealStatus.OVERTURNED]: [],
  [AppealStatus.PARTIALLY_UPHELD]: [],
  [AppealStatus.WITHDRAWN]: [],
};

export function canTransitionAppeal(from: AppealStatus, to: AppealStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface AppealResolution {
  readonly status: AppealStatus;
  /** ID des Menschen, der entschieden hat. */
  readonly reviewerId?: string;
  /** Assessment-ID, die der ursprünglichen Entscheidung zugrunde lag. */
  readonly originalAssessmentId?: string;
  /** Assessment-ID der Neubewertung im Einspruchsverfahren. */
  readonly reviewAssessmentId?: string;
}

export type AppealValidation =
  | { readonly valid: true }
  | { readonly valid: false; readonly reasonCode: string; readonly message: string };

/**
 * Prüft, ob eine Einspruchsentscheidung zulässig zustande kam.
 *
 * Unzulässig ist insbesondere: eine Ablehnung, die sich auf **dasselbe** automatisierte
 * Ergebnis stützt, oder eine Ablehnung mit erheblicher Geldwirkung ohne menschlichen
 * Prüfer (§36.5).
 */
export function validateAppealResolution(
  resolution: AppealResolution,
  decisionType: DecisionType,
): AppealValidation {
  const isRejection =
    resolution.status === AppealStatus.UPHELD || resolution.status === AppealStatus.PARTIALLY_UPHELD;

  if (!isRejection) return { valid: true };

  if (
    resolution.reviewAssessmentId !== undefined &&
    resolution.reviewAssessmentId === resolution.originalAssessmentId
  ) {
    return {
      valid: false,
      reasonCode: 'APPEAL_REUSED_ORIGINAL_ASSESSMENT',
      message:
        'Ein Einspruch darf nicht durch dasselbe automatisierte Ergebnis entschieden werden.',
    };
  }

  const significantMoneyEffect = AI_MAY_NEVER_FINALIZE.includes(decisionType);
  if (significantMoneyEffect && !resolution.reviewerId) {
    return {
      valid: false,
      reasonCode: 'APPEAL_REJECTION_WITHOUT_HUMAN',
      message: 'Eine Ablehnung mit erheblicher Geldwirkung erfordert eine menschliche Prüfung.',
    };
  }

  return { valid: true };
}

/** Der Einspruchsweg ist kostenlos — hier als expliziter, testbarer Vertrag. */
export const APPEAL_FEE_MINOR = 0;
