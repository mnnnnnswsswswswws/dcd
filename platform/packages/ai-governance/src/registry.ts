/**
 * AI Model Registry und Policy Registry (§36.2, §36.3).
 *
 * Grundsatz: **keine stillen Modellupdates**. Jede Produktionsentscheidung nennt die
 * eingesetzte Modell-, Prompt-, Policy- und Threshold-Version. Ein Modell ohne
 * registrierte, freigegebene Version darf nicht aufgerufen werden — der Einsatz einer
 * unregistrierten Version ist eine Stop-the-Line-Bedingung (§40).
 */

export const ModelStatus = {
  REGISTERED: 'REGISTERED',
  APPROVED: 'APPROVED',
  DISABLED: 'DISABLED',
  ROLLED_BACK: 'ROLLED_BACK',
} as const;
export type ModelStatus = (typeof ModelStatus)[keyof typeof ModelStatus];

export interface ModelVersion {
  readonly id: string;
  readonly provider: string;
  readonly modelName: string;
  readonly version: string;
  readonly purpose: string;
  readonly status: ModelStatus;
  readonly approvedBy?: string;
  readonly approvedAt?: Date;
  /** Ergebnisse der Pflicht-Evaluation (§36.4). */
  readonly evaluation?: EvaluationResult;
}

export interface PolicyVersion {
  readonly id: string;
  readonly policyFamily: string;
  readonly version: string;
  readonly effectiveFrom: Date;
  readonly approvedBy?: string;
}

/** Kennzahlen, die vor einem Deployment erfüllt sein müssen (§36.4). */
export interface EvaluationResult {
  readonly precision: number;
  readonly recall: number;
  readonly falsePositiveRate: number;
  readonly falseNegativeRate: number;
  /** Abweichung gegenüber der freigegebenen Referenz; hoher Wert = Drift. */
  readonly drift?: number;
  readonly evaluatedAt: Date;
}

/**
 * Mindestschwellen für ein Deployment. Bewusst konservativ bei False Negatives:
 * Ein übersehener Hochrisikoinhalt wiegt schwerer als ein Fehlalarm, den ein Mensch
 * korrigieren kann.
 */
export const DEPLOYMENT_THRESHOLDS = {
  minPrecision: 0.9,
  minRecall: 0.9,
  maxFalseNegativeRate: 0.05,
  maxDrift: 0.1,
} as const;

export interface DeploymentDecision {
  readonly allowed: boolean;
  readonly reasonCodes: readonly string[];
}

/** Blockiert ein Deployment, wenn kritische Schwellen verletzt sind (§36.4). */
export function evaluateDeployment(model: ModelVersion): DeploymentDecision {
  const reasons: string[] = [];
  if (model.status === ModelStatus.DISABLED) reasons.push('MODEL_DISABLED');
  if (model.status === ModelStatus.ROLLED_BACK) reasons.push('MODEL_ROLLED_BACK');
  if (!model.evaluation) {
    reasons.push('EVALUATION_MISSING');
  } else {
    const e = model.evaluation;
    if (e.precision < DEPLOYMENT_THRESHOLDS.minPrecision) reasons.push('PRECISION_BELOW_THRESHOLD');
    if (e.recall < DEPLOYMENT_THRESHOLDS.minRecall) reasons.push('RECALL_BELOW_THRESHOLD');
    if (e.falseNegativeRate > DEPLOYMENT_THRESHOLDS.maxFalseNegativeRate) {
      reasons.push('FALSE_NEGATIVE_RATE_TOO_HIGH');
    }
    if (e.drift !== undefined && e.drift > DEPLOYMENT_THRESHOLDS.maxDrift) {
      reasons.push('SIGNIFICANT_MODEL_DRIFT');
    }
  }
  if (model.status !== ModelStatus.APPROVED && reasons.length === 0) {
    reasons.push('MODEL_NOT_APPROVED');
  }
  return { allowed: reasons.length === 0, reasonCodes: reasons };
}

/** Fehler bei Einsatz eines nicht registrierten oder gesperrten Modells. */
export class UnregisteredModelError extends Error {
  constructor(modelRef: string) {
    super(`KI-Modell ohne gültige Registrierung eingesetzt: ${modelRef}`);
    this.name = 'UnregisteredModelError';
  }
}

/**
 * Torwächter vor jedem Modellaufruf: Nur freigegebene, nicht deaktivierte Versionen
 * dürfen laufen. Ein deaktiviertes Modell wird nicht mehr aufgerufen (§39, AI-Test).
 */
export function assertModelUsable(
  registry: ReadonlyMap<string, ModelVersion>,
  modelVersionId: string,
): ModelVersion {
  const model = registry.get(modelVersionId);
  if (!model) throw new UnregisteredModelError(modelVersionId);
  if (model.status !== ModelStatus.APPROVED) throw new UnregisteredModelError(modelVersionId);
  return model;
}
