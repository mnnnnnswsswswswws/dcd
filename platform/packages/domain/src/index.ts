/**
 * Domänen-State-Machines als explizite Übergangsmatrizen.
 *
 * Die String-Werte spiegeln die Prisma-Enums (`ChallengeStatus`, `SlotStatus`,
 * `SubmissionStatus`) 1:1 wider, sind hier aber lokal definiert, damit die
 * Domänenlogik ohne generierten Prisma-Client rein testbar bleibt.
 */

export const ChallengeStatus = {
  DRAFT: 'DRAFT',
  PENDING_FUNDING: 'PENDING_FUNDING',
  OPEN: 'OPEN',
  FULL: 'FULL',
  SUBMISSIONS_CLOSED: 'SUBMISSIONS_CLOSED',
  IN_REVIEW: 'IN_REVIEW',
  SELECTION: 'SELECTION',
  WINNER_LOCKED: 'WINNER_LOCKED',
  PAID_OUT: 'PAID_OUT',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
} as const;
export type ChallengeStatus = (typeof ChallengeStatus)[keyof typeof ChallengeStatus];

export const SlotStatus = {
  RESERVED: 'RESERVED',
  CAPTURING: 'CAPTURING',
  UPLOADING: 'UPLOADING',
  SUBMITTED: 'SUBMITTED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
} as const;
export type SlotStatus = (typeof SlotStatus)[keyof typeof SlotStatus];

export const SubmissionStatus = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  WINNER: 'WINNER',
  LOSER: 'LOSER',
} as const;
export type SubmissionStatus = (typeof SubmissionStatus)[keyof typeof SubmissionStatus];

/**
 * Slot-Status, die auf das Platz-Limit einer Challenge zählen: ein Nutzer belegt
 * einen Platz, sobald er reserviert (und nicht abgelaufen) ist, aufnimmt, hochlädt
 * oder eingereicht hat. Genau diese Menge begrenzt `maxSlots` (= 10).
 */
export const COUNTING_SLOT_STATUSES: readonly SlotStatus[] = [
  SlotStatus.RESERVED,
  SlotStatus.CAPTURING,
  SlotStatus.UPLOADING,
  SlotStatus.SUBMITTED,
];

export function isCountingSlotStatus(status: SlotStatus): boolean {
  return COUNTING_SLOT_STATUSES.includes(status);
}

/** Submission-Status, die als endgültige/gültige Einsendung eines Nutzers gelten. */
export const FINAL_SUBMISSION_STATUSES: readonly SubmissionStatus[] = [
  SubmissionStatus.SUBMITTED,
  SubmissionStatus.APPROVED,
  SubmissionStatus.REJECTED,
  SubmissionStatus.WINNER,
  SubmissionStatus.LOSER,
];

export function isFinalSubmissionStatus(status: SubmissionStatus): boolean {
  return FINAL_SUBMISSION_STATUSES.includes(status);
}

/** Nur freigegebene (`APPROVED`) Einsendungen sind gewinnberechtigt. */
export const WINNING_ELIGIBLE_SUBMISSION_STATUS: SubmissionStatus = SubmissionStatus.APPROVED;

/** Quelle der Gewinnerentscheidung. */
export const DecisionSource = {
  CREATOR: 'CREATOR',
  COMMUNITY_VOTE: 'COMMUNITY_VOTE',
  AUTO_FALLBACK: 'AUTO_FALLBACK',
} as const;
export type DecisionSource = (typeof DecisionSource)[keyof typeof DecisionSource];

/** Meldbare Ziel-Typen und Meldegründe (Spec 14.5). */
export const REPORT_TARGET_TYPES = ['CHALLENGE', 'SUBMISSION', 'COMMENT', 'USER'] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

export const REPORT_REASONS = [
  'DANGEROUS',
  'ILLEGAL',
  'VIOLENCE',
  'SEXUAL',
  'MINORS',
  'HARASSMENT',
  'FRAUD',
  'COPYRIGHT',
  'PRIVACY',
  'SPAM',
  'OTHER',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export type ReportPriority = 'LOW' | 'MEDIUM' | 'HIGH';

const HIGH_PRIORITY_REASONS: readonly ReportReason[] = ['DANGEROUS', 'ILLEGAL', 'VIOLENCE', 'SEXUAL', 'MINORS'];
const MEDIUM_PRIORITY_REASONS: readonly ReportReason[] = ['HARASSMENT', 'FRAUD', 'PRIVACY'];

/** Leitet die Bearbeitungspriorität aus dem Meldegrund ab (schwere Gründe zuerst). */
export function reasonToPriority(reason: ReportReason): ReportPriority {
  if (HIGH_PRIORITY_REASONS.includes(reason)) return 'HIGH';
  if (MEDIUM_PRIORITY_REASONS.includes(reason)) return 'MEDIUM';
  return 'LOW';
}

type TransitionMatrix<S extends string> = Readonly<Record<S, readonly S[]>>;

/** Erlaubte Statusübergänge einer Challenge (fokussierter Ausschnitt). */
export const CHALLENGE_TRANSITIONS: TransitionMatrix<ChallengeStatus> = {
  DRAFT: [ChallengeStatus.PENDING_FUNDING, ChallengeStatus.CANCELLED],
  PENDING_FUNDING: [ChallengeStatus.OPEN, ChallengeStatus.CANCELLED, ChallengeStatus.EXPIRED],
  OPEN: [ChallengeStatus.FULL, ChallengeStatus.SUBMISSIONS_CLOSED, ChallengeStatus.CANCELLED, ChallengeStatus.EXPIRED],
  // FULL kann wieder zu OPEN werden, wenn ein Slot abläuft und Platz frei wird.
  FULL: [ChallengeStatus.OPEN, ChallengeStatus.SUBMISSIONS_CLOSED, ChallengeStatus.CANCELLED],
  // WINNER_LOCKED ist aus SUBMISSIONS_CLOSED direkt erreichbar; SELECTION/IN_REVIEW
  // bleiben als optionale Zwischenzustände erhalten.
  SUBMISSIONS_CLOSED: [
    ChallengeStatus.IN_REVIEW,
    ChallengeStatus.SELECTION,
    ChallengeStatus.WINNER_LOCKED,
    ChallengeStatus.CANCELLED,
  ],
  IN_REVIEW: [ChallengeStatus.SELECTION, ChallengeStatus.CANCELLED],
  SELECTION: [ChallengeStatus.WINNER_LOCKED, ChallengeStatus.CANCELLED],
  WINNER_LOCKED: [ChallengeStatus.PAID_OUT],
  PAID_OUT: [],
  CANCELLED: [],
  EXPIRED: [],
};

/** Erlaubte Statusübergänge eines Slots (fokussierter Ausschnitt). */
export const SLOT_TRANSITIONS: TransitionMatrix<SlotStatus> = {
  RESERVED: [SlotStatus.CAPTURING, SlotStatus.EXPIRED, SlotStatus.CANCELLED],
  CAPTURING: [SlotStatus.UPLOADING, SlotStatus.CANCELLED],
  UPLOADING: [SlotStatus.SUBMITTED, SlotStatus.CANCELLED],
  SUBMITTED: [SlotStatus.CANCELLED],
  EXPIRED: [],
  CANCELLED: [],
};

/** Erlaubte Statusübergänge einer Submission (fokussierter Ausschnitt). */
export const SUBMISSION_TRANSITIONS: TransitionMatrix<SubmissionStatus> = {
  DRAFT: [SubmissionStatus.SUBMITTED],
  SUBMITTED: [SubmissionStatus.APPROVED, SubmissionStatus.REJECTED],
  APPROVED: [SubmissionStatus.WINNER, SubmissionStatus.LOSER],
  REJECTED: [],
  WINNER: [],
  LOSER: [],
};

function canTransition<S extends string>(matrix: TransitionMatrix<S>, from: S, to: S): boolean {
  const allowed = matrix[from];
  return allowed !== undefined && allowed.includes(to);
}

export function canTransitionChallenge(from: ChallengeStatus, to: ChallengeStatus): boolean {
  return canTransition(CHALLENGE_TRANSITIONS, from, to);
}

export function canTransitionSlot(from: SlotStatus, to: SlotStatus): boolean {
  return canTransition(SLOT_TRANSITIONS, from, to);
}

export function canTransitionSubmission(from: SubmissionStatus, to: SubmissionStatus): boolean {
  return canTransition(SUBMISSION_TRANSITIONS, from, to);
}
