/**
 * Durchsatzbudget (Scale S2).
 *
 * Das Gegenstück zum Verbindungsbudget — und die Lücke, an der die erste Auslegung
 * gescheitert ist.
 *
 * Für Verbindungen gab es eine hergeleitete Obergrenze und ein Gate, das bei
 * Überschreitung rot wird. Für **Durchsatz** gab es nichts: Batchgrößen und
 * Scheduler-Takte standen als Literale im Code, ohne dass irgendwo eine Zielrate
 * notiert war, gegen die man sie hätte prüfen können. Die Folge war eine harte
 * Decke, die niemandem auffiel, weil sie nirgends ausgerechnet stand:
 *
 *     Beweisprüfung: batchSize 20, Takt alle 5 Minuten  →  4 Einsendungen/Minute.
 *
 * Ab der fünften Einsendung pro Minute wächst der Rückstand unbegrenzt, und jeder
 * Nutzer sitzt unbefristet auf `PENDING`. Nichts im Code hat das gemeldet, weil
 * nichts danach gefragt hat.
 *
 * Diese Datei stellt die Frage. Sie führt die Zielraten und rechnet aus, was ein
 * Verarbeiter leisten muss; ein Test vergleicht das mit der tatsächlichen
 * Konfiguration. Eine geratene Zahl kann dadurch nicht mehr unbemerkt zu klein sein.
 *
 * Die Regel dahinter, die beim ersten Mal gefehlt hat: **Jeder Verarbeiter mit
 * Batchgröße und Takt braucht eine Zielrate.** Ohne sie ist die Auslegung kein
 * Entwurf, sondern eine Vermutung.
 */

/** Erwartete Last zur Spitze. Grundlage jeder Auslegung — nicht der Durchschnitt. */
export interface TargetLoad {
  /**
   * Einsendungen pro Minute zur Spitze. Jede Einsendung mit Beweisvideo erzeugt
   * genau eine Prüf-Operation.
   */
  readonly submissionsPerMinute: number;
  /**
   * Domänen-Ereignisse pro Sekunde. Eine Teilnahme, eine Einsendung, eine
   * Moderation — jede Zustandsänderung schreibt einen Outbox-Eintrag.
   */
  readonly domainEventsPerSecond: number;
  /**
   * Sicherheitsfaktor auf alle abgeleiteten Größen. Eine Auslegung, die die
   * Zielrate exakt trifft, hat bei der ersten Abweichung keinen Puffer — und
   * Rückstand baut sich schneller auf, als er sich abbaut.
   */
  readonly headroomFactor: number;
}

/**
 * Zielwerte für die geschlossene Beta.
 *
 * Bewusst niedrig angesetzt und ausdrücklich als **Annahme** markiert: Diese Zahlen
 * sind hergeleitet, nicht gemessen. Sobald echte Lastdaten vorliegen, werden sie
 * ersetzt — und der Test unten sagt sofort, welche Verarbeiter dann zu klein sind.
 */
export const DEFAULT_TARGET_LOAD: TargetLoad = {
  submissionsPerMinute: 120,
  domainEventsPerSecond: 50,
  headroomFactor: 2,
};

/** Ein Verarbeiter, der in Stapeln auf einem festen Takt arbeitet. */
export interface BatchProcessor {
  readonly name: string;
  /** Einträge, die ein einzelner Lauf höchstens greift. */
  readonly batchSize: number;
  /** Abstand zwischen zwei Läufen in Sekunden (Scheduler-Takt). */
  readonly intervalSeconds: number;
  /**
   * Gleichzeitige Läufe. Bei Cloud-Run-Jobs die `parallelism`, nicht die
   * budgetierte Instanzzahl — genau diese Verwechslung hat die Kapazitätstabelle
   * vier Publisher glauben lassen, während tatsächlich einer lief.
   */
  readonly parallelism: number;
  /** Verarbeitet ein Lauf bis zur Erschöpfung statt nur einen Stapel? */
  readonly drainsFully: boolean;
  readonly notes?: string;
}

/**
 * Was ein Verarbeiter pro Minute schafft.
 *
 * `drainsFully` bedeutet: Der Lauf wiederholt seinen Stapel, bis nichts mehr da
 * ist. Dann ist die Batchgröße keine Decke mehr, sondern nur die Stückelung —
 * begrenzt wird erst durch die Laufzeit, nicht durch den Takt.
 */
export function ratePerMinute(p: BatchProcessor): number {
  if (p.drainsFully) return Number.POSITIVE_INFINITY;
  const runsPerMinute = 60 / p.intervalSeconds;
  return p.batchSize * runsPerMinute * p.parallelism;
}

export interface ThroughputRequirement {
  readonly processor: string;
  /** Was mindestens pro Minute durchgehen muss, inklusive Puffer. */
  readonly requiredPerMinute: number;
  readonly actualPerMinute: number;
  readonly sufficient: boolean;
}

export interface ThroughputReport {
  readonly withinBudget: boolean;
  readonly requirements: readonly ThroughputRequirement[];
  readonly violations: readonly string[];
}

/**
 * Prüft jeden Verarbeiter gegen die Rate, die er tragen muss.
 *
 * Die Zuordnung „welcher Verarbeiter trägt welche Rate" steht hier explizit statt
 * im Kopf der auslegenden Person — sonst wandert sie beim nächsten Umbau verloren.
 */
export function computeThroughput(
  processors: readonly BatchProcessor[],
  load: TargetLoad = DEFAULT_TARGET_LOAD,
): ThroughputReport {
  const bedarf: Record<string, number> = {
    // Eine Prüf-Operation je Einsendung mit Beweisvideo.
    'evidence-verification': load.submissionsPerMinute * load.headroomFactor,
    // Jede Zustandsänderung schreibt einen Outbox-Eintrag.
    'outbox-publisher': load.domainEventsPerSecond * 60 * load.headroomFactor,
    // Der Consumer muss mindestens so schnell sein wie der Publisher, sonst
    // wandert der Rückstand nur eine Stufe weiter.
    'projection-consumer': load.domainEventsPerSecond * 60 * load.headroomFactor,
  };

  const requirements: ThroughputRequirement[] = [];
  const violations: string[] = [];

  for (const p of processors) {
    const required = bedarf[p.name];
    if (required === undefined) {
      violations.push(
        `${p.name}: keine Zielrate hinterlegt. Ein Verarbeiter ohne Zielrate ist nicht ausgelegt, sondern geraten.`,
      );
      continue;
    }
    const actual = ratePerMinute(p);
    const sufficient = actual >= required;
    requirements.push({
      processor: p.name,
      requiredPerMinute: required,
      actualPerMinute: actual,
      sufficient,
    });
    if (!sufficient) {
      violations.push(
        `${p.name}: schafft ${actual}/min, braucht ${required}/min. ` +
          `Bei ${p.batchSize} je Lauf alle ${p.intervalSeconds}s (parallel ${p.parallelism}) ` +
          `wächst der Rückstand unbegrenzt.`,
      );
    }
  }

  // Ein Bedarfsposten ohne Verarbeiter ist genauso gefährlich: Die Arbeit fällt an,
  // und niemand holt sie ab.
  for (const name of Object.keys(bedarf)) {
    if (!processors.some((p) => p.name === name)) {
      violations.push(`${name}: Zielrate hinterlegt, aber kein Verarbeiter konfiguriert.`);
    }
  }

  return { withinBudget: violations.length === 0, requirements, violations };
}

/**
 * Leitet die nötige Batchgröße aus Zielrate und Takt ab — die Richtung, die beim
 * ersten Mal gefehlt hat: von der Last zur Konfiguration, nicht umgekehrt.
 */
export function deriveBatchSize(
  requiredPerMinute: number,
  intervalSeconds: number,
  parallelism = 1,
): number {
  if (intervalSeconds <= 0) throw new Error('intervalSeconds muss positiv sein.');
  if (parallelism <= 0) throw new Error('parallelism muss positiv sein.');
  const runsPerMinute = 60 / intervalSeconds;
  return Math.ceil(requiredPerMinute / (runsPerMinute * parallelism));
}

/**
 * Tatsächliche Konfiguration der Verarbeiter.
 *
 * Muss mit dem Code und mit `infrastructure/terraform/variables.tf` übereinstimmen;
 * Tests prüfen beide Richtungen.
 */
export const PROCESSORS: readonly BatchProcessor[] = [
  {
    name: 'evidence-verification',
    // 240 = 120 Einsendungen/min x Puffer 2, auf einen Lauf pro Minute verteilt.
    // Der erste Versuch stand hier bei 200 — der Test unten hat ihn abgelehnt.
    batchSize: 240,
    intervalSeconds: 60,
    parallelism: 1,
    drainsFully: false,
    notes:
      'Läuft in worker-sweeps. Vorher 20 alle 300s = 4/min — die Decke, an der die ' +
      'Auslegung gescheitert ist. Jetzt aus DEFAULT_TARGET_LOAD abgeleitet.',
  },
  {
    name: 'outbox-publisher',
    batchSize: 100,
    intervalSeconds: 60,
    parallelism: 2,
    drainsFully: true,
    notes:
      'Ein Lauf leert die Outbox vollständig (drain), die Batchgröße ist nur die ' +
      'Stückelung. Begrenzend ist die Zustellrate zum Broker — deshalb wird ' +
      'innerhalb eines Stapels über Ordering Keys hinweg parallel zugestellt.',
  },
  {
    name: 'projection-consumer',
    batchSize: 100,
    intervalSeconds: 60,
    parallelism: 2,
    drainsFully: true,
    notes: 'Im Abonnement-Modus zustellungsgetrieben; im Direktmodus wie der Publisher.',
  },
];

export class ThroughputBudgetError extends Error {
  readonly report: ThroughputReport;
  constructor(report: ThroughputReport) {
    super(`Durchsatzbudget verletzt:\n- ${report.violations.join('\n- ')}`);
    this.name = 'ThroughputBudgetError';
    this.report = report;
  }
}

/** Harte Variante für CI und Deploy-Gates. */
export function assertThroughput(
  processors: readonly BatchProcessor[] = PROCESSORS,
  load: TargetLoad = DEFAULT_TARGET_LOAD,
): ThroughputReport {
  const report = computeThroughput(processors, load);
  if (!report.withinBudget) throw new ThroughputBudgetError(report);
  return report;
}
