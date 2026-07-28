import { describe, expect, it } from 'vitest';
import {
  ModelStatus,
  UnregisteredModelError,
  assertModelUsable,
  evaluateDeployment,
  type ModelVersion,
} from './registry.js';
import {
  AI_MAY_NEVER_FINALIZE,
  DecisionType,
  Outcome,
  RiskLevel,
  buildReasonStatement,
  decide,
  type AiAssessment,
} from './decisions.js';
import {
  APPEAL_FEE_MINOR,
  AppealStatus,
  canTransitionAppeal,
  validateAppealResolution,
} from './appeals.js';

const model = (over: Partial<ModelVersion> = {}): ModelVersion => ({
  id: 'm1',
  provider: 'p',
  modelName: 'moderation',
  version: '1.0.0',
  purpose: 'content-moderation',
  status: ModelStatus.APPROVED,
  evaluation: {
    precision: 0.95,
    recall: 0.94,
    falsePositiveRate: 0.03,
    falseNegativeRate: 0.02,
    evaluatedAt: new Date('2026-07-01T00:00:00Z'),
  },
  ...over,
});

const assessment = (over: Partial<AiAssessment> = {}): AiAssessment => ({
  modelVersionId: 'm1',
  policyVersionId: 'p1',
  riskLevel: RiskLevel.LOW,
  confidence: 0.99,
  policyCodes: [],
  ...over,
});

const cleanPolicy = { prohibited: false, policyCodes: [] as string[] };

describe('Model Registry', () => {
  it('lässt kein unregistriertes Modell zu', () => {
    expect(() => assertModelUsable(new Map(), 'unknown')).toThrow(UnregisteredModelError);
  });

  it('ruft ein deaktiviertes Modell nicht mehr auf', () => {
    const reg = new Map([['m1', model({ status: ModelStatus.DISABLED })]]);
    expect(() => assertModelUsable(reg, 'm1')).toThrow(UnregisteredModelError);
  });

  it('erlaubt ein freigegebenes Modell', () => {
    const reg = new Map([['m1', model()]]);
    expect(assertModelUsable(reg, 'm1').version).toBe('1.0.0');
  });

  it('blockiert ein Deployment ohne Evaluation', () => {
    const d = evaluateDeployment(model({ evaluation: undefined }));
    expect(d.allowed).toBe(false);
    expect(d.reasonCodes).toContain('EVALUATION_MISSING');
  });

  it('blockiert ein Deployment bei zu hoher False-Negative-Rate', () => {
    const d = evaluateDeployment(
      model({ evaluation: { ...model().evaluation!, falseNegativeRate: 0.3 } }),
    );
    expect(d.allowed).toBe(false);
    expect(d.reasonCodes).toContain('FALSE_NEGATIVE_RATE_TOO_HIGH');
  });

  it('blockiert bei erheblichem Drift', () => {
    const d = evaluateDeployment(model({ evaluation: { ...model().evaluation!, drift: 0.5 } }));
    expect(d.reasonCodes).toContain('SIGNIFICANT_MODEL_DRIFT');
  });

  it('erlaubt ein sauber evaluiertes Modell', () => {
    expect(evaluateDeployment(model()).allowed).toBe(true);
  });
});

describe('KI darf geldnahe Entscheidungen nicht finalisieren', () => {
  it('schickt jede Auszahlungssperre in die menschliche Prüfung', () => {
    const r = decide({
      decisionType: DecisionType.PAYOUT_HOLD,
      policyVerdict: cleanPolicy,
      assessments: [assessment({ riskLevel: RiskLevel.PROHIBITED })],
      automaticRejectionEnabled: true,
    });
    expect(r.outcome).toBe(Outcome.HUMAN_REVIEW);
    expect(r.humanConfirmationRequired).toBe(true);
    expect(r.reasonCodes).toContain('AI_MAY_NOT_FINALIZE');
  });

  it('lässt KI keine Auszahlung freigeben', () => {
    const r = decide({
      decisionType: DecisionType.PAYOUT_RELEASE,
      policyVerdict: cleanPolicy,
      assessments: [assessment()],
    });
    expect(r.outcome).toBe(Outcome.HUMAN_REVIEW);
  });

  it('lässt KI keinen Gewinner bestimmen', () => {
    const r = decide({
      decisionType: DecisionType.WINNER_DETERMINATION,
      policyVerdict: cleanPolicy,
      assessments: [assessment()],
    });
    expect(r.outcome).toBe(Outcome.HUMAN_REVIEW);
  });

  it('lässt KI kein Konto dauerhaft sperren — auch bei klarem Policy-Verstoß nicht', () => {
    const r = decide({
      decisionType: DecisionType.ACCOUNT_SUSPEND_PERMANENT,
      policyVerdict: { prohibited: true, policyCodes: ['ILLEGAL_ACT'] },
      assessments: [assessment({ riskLevel: RiskLevel.PROHIBITED })],
      automaticRejectionEnabled: true,
    });
    expect(r.outcome).toBe(Outcome.HUMAN_REVIEW);
    expect(r.reasonCodes).toContain('AI_MAY_NOT_FINALIZE');
  });

  it('deckt genau die vier unantastbaren Entscheidungsarten ab', () => {
    expect([...AI_MAY_NEVER_FINALIZE].sort()).toEqual([
      'ACCOUNT_SUSPEND_PERMANENT',
      'PAYOUT_HOLD',
      'PAYOUT_RELEASE',
      'WINNER_DETERMINATION',
    ]);
  });
});

describe('Entscheidungsmatrix', () => {
  it('gibt niedriges Risiko mit hoher Konfidenz automatisch frei', () => {
    const r = decide({
      decisionType: DecisionType.CONTENT_PUBLISH,
      policyVerdict: cleanPolicy,
      assessments: [assessment()],
    });
    expect(r.outcome).toBe(Outcome.AUTO_APPROVE);
  });

  it('schickt niedrige Konfidenz in die Prüfung', () => {
    const r = decide({
      decisionType: DecisionType.CONTENT_PUBLISH,
      policyVerdict: cleanPolicy,
      assessments: [assessment({ confidence: 0.4 })],
    });
    expect(r.outcome).toBe(Outcome.HUMAN_REVIEW);
    expect(r.reasonCodes).toContain('LOW_CONFIDENCE');
  });

  it('schickt widersprüchliche Modelle in die Prüfung', () => {
    const r = decide({
      decisionType: DecisionType.CONTENT_PUBLISH,
      policyVerdict: cleanPolicy,
      assessments: [assessment(), assessment({ modelVersionId: 'm2', riskLevel: RiskLevel.HIGH })],
    });
    expect(r.outcome).toBe(Outcome.HUMAN_REVIEW);
    expect(r.reasonCodes).toContain('CONFLICTING_ASSESSMENTS');
  });

  it('lässt eine offene Meldung nie automatisch durch', () => {
    const r = decide({
      decisionType: DecisionType.CONTENT_PUBLISH,
      policyVerdict: cleanPolicy,
      assessments: [assessment()],
      hasOpenReport: true,
    });
    expect(r.outcome).toBe(Outcome.HUMAN_REVIEW);
    expect(r.reasonCodes).toContain('OPEN_REPORT');
  });

  it('blockiert nicht automatisch, solange die automatische Ablehnung aus ist', () => {
    const r = decide({
      decisionType: DecisionType.CONTENT_REMOVE,
      policyVerdict: cleanPolicy,
      assessments: [assessment({ riskLevel: RiskLevel.HIGH })],
      // automaticRejectionEnabled fehlt = Default aus
    });
    expect(r.outcome).toBe(Outcome.HUMAN_REVIEW);
    expect(r.reasonCodes).toContain('AUTOMATIC_REJECTION_DISABLED');
  });

  it('setzt die deterministische Policy Engine vor das Modell', () => {
    const r = decide({
      decisionType: DecisionType.CHALLENGE_REJECT,
      policyVerdict: { prohibited: true, policyCodes: ['WEAPONS'] },
      // Das Modell hält den Inhalt für harmlos — die Policy gewinnt trotzdem.
      assessments: [assessment({ riskLevel: RiskLevel.LOW, confidence: 0.99 })],
    });
    expect(r.outcome).toBe(Outcome.AUTO_BLOCK);
    expect(r.reasonCodes).toContain('POLICY_PROHIBITED');
    expect(r.reasonCodes).toContain('WEAPONS');
  });

  it('prüft menschlich, wenn gar keine Bewertung vorliegt', () => {
    const r = decide({
      decisionType: DecisionType.CONTENT_PUBLISH,
      policyVerdict: cleanPolicy,
      assessments: [],
    });
    expect(r.outcome).toBe(Outcome.HUMAN_REVIEW);
    expect(r.reasonCodes).toContain('NO_ASSESSMENT');
  });

  it('führt Modell- und Policy-Version in jeder Entscheidung mit', () => {
    const r = decide({
      decisionType: DecisionType.CONTENT_PUBLISH,
      policyVerdict: cleanPolicy,
      assessments: [assessment()],
    });
    expect(r.modelVersionIds).toEqual(['m1']);
    expect(r.policyVersionIds).toEqual(['p1']);
  });
});

describe('Reason Statements', () => {
  it('nennt automatisierte Mittel und den Rechtsbehelf', () => {
    const result = decide({
      decisionType: DecisionType.CONTENT_REMOVE,
      policyVerdict: { prohibited: true, policyCodes: ['DANGEROUS_ACT'] },
      assessments: [assessment({ riskLevel: RiskLevel.PROHIBITED })],
    });
    const rs = buildReasonStatement({
      decisionType: DecisionType.CONTENT_REMOVE,
      targetType: 'submission',
      targetId: 's1',
      result,
      userFacingText: 'Dein Video wurde entfernt, weil es eine gefährliche Handlung zeigt.',
      humanReviewUsed: false,
    });
    expect(rs.automatedMeansUsed).toBe(true);
    expect(rs.redressOptions).toContain('INTERNAL_APPEAL');
    expect(rs.redressOptions).toContain('HUMAN_CONTACT');
    expect(rs.policyReferences).toContain('DANGEROUS_ACT');
    expect(rs.modelVersionIds).toEqual(['m1']);
  });
});

describe('Einspruchsverfahren', () => {
  it('ist kostenlos', () => {
    expect(APPEAL_FEE_MINOR).toBe(0);
  });

  it('erlaubt nur sinnvolle Übergänge', () => {
    expect(canTransitionAppeal(AppealStatus.SUBMITTED, AppealStatus.UNDER_REVIEW)).toBe(true);
    expect(canTransitionAppeal(AppealStatus.UNDER_REVIEW, AppealStatus.OVERTURNED)).toBe(true);
    // Ein abgeschlossener Einspruch wird nicht wieder geöffnet.
    expect(canTransitionAppeal(AppealStatus.OVERTURNED, AppealStatus.UNDER_REVIEW)).toBe(false);
    // Ohne Prüfung direkt ablehnen ist nicht vorgesehen.
    expect(canTransitionAppeal(AppealStatus.SUBMITTED, AppealStatus.UPHELD)).toBe(false);
  });

  it('lehnt eine Ablehnung ab, die dasselbe automatisierte Ergebnis wiederverwendet', () => {
    const v = validateAppealResolution(
      {
        status: AppealStatus.UPHELD,
        reviewerId: 'mod-1',
        originalAssessmentId: 'a1',
        reviewAssessmentId: 'a1',
      },
      DecisionType.CONTENT_REMOVE,
    );
    expect(v.valid).toBe(false);
    if (!v.valid) expect(v.reasonCode).toBe('APPEAL_REUSED_ORIGINAL_ASSESSMENT');
  });

  it('verlangt bei erheblicher Geldwirkung einen menschlichen Prüfer', () => {
    const v = validateAppealResolution(
      { status: AppealStatus.UPHELD, originalAssessmentId: 'a1', reviewAssessmentId: 'a2' },
      DecisionType.PAYOUT_HOLD,
    );
    expect(v.valid).toBe(false);
    if (!v.valid) expect(v.reasonCode).toBe('APPEAL_REJECTION_WITHOUT_HUMAN');
  });

  it('akzeptiert eine unabhängige, menschlich geprüfte Ablehnung', () => {
    const v = validateAppealResolution(
      {
        status: AppealStatus.UPHELD,
        reviewerId: 'mod-2',
        originalAssessmentId: 'a1',
        reviewAssessmentId: 'a2',
      },
      DecisionType.PAYOUT_HOLD,
    );
    expect(v.valid).toBe(true);
  });

  it('lässt eine Aufhebung ohne Zusatzhürde zu', () => {
    expect(
      validateAppealResolution({ status: AppealStatus.OVERTURNED }, DecisionType.PAYOUT_HOLD).valid,
    ).toBe(true);
  });
});
