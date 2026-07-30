/**
 * @vcp/capacity — Kapazitätsableitung und Verbindungsbudget (Scale S1, Aufgaben 12–13).
 *
 * Architekturregel 9: Cloud-Run-Maximalinstanzen werden **aus** DB-, Redis- und
 * Providerkapazität abgeleitet, nicht frei gewählt. Der teure Fehler ist immer
 * derselbe: Ein Dienst skaliert unter Last hoch, jede Instanz öffnet ihren Pool, und
 * die Datenbank lehnt Verbindungen ab — ausgerechnet dann, wenn sie gebraucht wird.
 *
 * Diese Datei ist die einzige Quelle der Wahrheit für diese Zahlen. Terraform setzt
 * sie, und ein CI-Test prüft, dass das Budget eingehalten wird. So kann eine erhöhte
 * `max_instances` nicht unbemerkt das Limit sprengen.
 */

export interface ServiceCapacity {
  readonly service: string;
  /** Cloud Run: maximale gleichzeitige Instanzen. */
  readonly maxInstances: number;
  /** Cloud Run: gleichzeitige Requests je Instanz. */
  readonly concurrency: number;
  /**
   * Verbindungen, die eine Instanz maximal zur Datenbank offen hält.
   *
   * `0` heißt: Der Dienst spricht **nicht** mit der Datenbank. Das ist keine
   * Buchhaltungsfeinheit — Terraform leitet daraus ab, ob der Dienst überhaupt
   * `roles/cloudsql.client`, das `DATABASE_URL`-Secret und den Cloud-SQL-Mount
   * bekommt. Eine falsche 0 bricht den Dienst; eine falsche Zahl > 0 vergibt
   * Rechte, die niemand braucht.
   */
  readonly dbPoolSize: number;
  /** Verbindungen zu Redis je Instanz (0 = nutzt Redis nicht). */
  readonly redisPoolSize: number;
  readonly notes?: string;
}

export interface CapacityLimits {
  /** `max_connections` der PostgreSQL-Instanz. */
  readonly dbMaxConnections: number;
  /**
   * Verbindungen, die für Betrieb reserviert bleiben: Superuser-Slots, Migrationen,
   * manuelle Diagnose. Ohne diese Reserve sperrt man sich im Ernstfall selbst aus.
   */
  readonly dbReservedConnections: number;
  readonly redisMaxConnections: number;
  readonly redisReservedConnections: number;
}

/**
 * Werte für die geschlossene Beta.
 *
 * Bewusst konservativ: Lieber ein Dienst, der bei Lastspitzen kurz drosselt, als
 * eine Datenbank, die Verbindungen ablehnt. Die Grenzen werden erst angehoben,
 * wenn die Pflichtlasttests (Aufgabe 14) grün sind.
 */
export const DEFAULT_LIMITS: CapacityLimits = {
  // Cloud SQL db-custom-2-7680 bietet ~200; Neon-Pooler entsprechend konfiguriert.
  dbMaxConnections: 200,
  dbReservedConnections: 20,
  redisMaxConnections: 1_000,
  redisReservedConnections: 50,
};

/**
 * Kanonische Dienstkonfiguration. Terraform liest exakt diese Zahlen
 * (siehe infrastructure/terraform/capacity.auto.tfvars.json).
 */
export const SERVICE_CAPACITY: readonly ServiceCapacity[] = [
  {
    service: 'api',
    maxInstances: 20,
    concurrency: 80,
    dbPoolSize: 5,
    redisPoolSize: 2,
    notes:
      'Öffentlicher Request-Pfad. Kleiner Pool je Instanz, dafür viele Instanzen. ' +
      'Redis 2 statt 20: Der Adapter in apps/api/src/cache/cache.module.ts hält genau ' +
      'einen ioredis-Client, also eine Verbindung; die zweite deckt die Überlappung ' +
      'während eines Reconnects. Eine größere Zahl würde Verbindungen budgetieren, ' +
      'die niemand öffnet.',
  },
  {
    service: 'worker-outbox',
    maxInstances: 4,
    concurrency: 1,
    dbPoolSize: 4,
    redisPoolSize: 0,
    notes: 'FOR UPDATE SKIP LOCKED erlaubt Parallelität ohne Blockade.',
  },
  {
    service: 'worker-sweeps',
    maxInstances: 2,
    concurrency: 1,
    dbPoolSize: 4,
    redisPoolSize: 0,
    notes: 'Slot-Expiry und Fristen. Idempotent, daher unkritisch bei Überlappung.',
  },
  {
    service: 'worker-projection',
    maxInstances: 4,
    concurrency: 1,
    dbPoolSize: 4,
    redisPoolSize: 2,
    notes: 'Read-Model-Consumer. Skaliert mit dem Event-Durchsatz. Redis wie bei api: ein Client.',
  },
  {
    service: 'admin',
    maxInstances: 2,
    concurrency: 40,
    dbPoolSize: 0,
    redisPoolSize: 0,
    notes:
      'Next.js-Client ohne Server-State: spricht ausschließlich über HTTP mit der API ' +
      'und hat weder @prisma/client noch einen Redis-Client als Abhängigkeit. Deshalb 0 — ' +
      'und deshalb weder cloudsql.client noch DATABASE_URL.',
  },
  {
    service: 'web',
    maxInstances: 4,
    concurrency: 80,
    dbPoolSize: 0,
    redisPoolSize: 0,
    notes: 'Teilnehmer-Frontend, ebenfalls reiner API-Client. Öffentlich, daher mehr Instanzen als admin.',
  },
];

export interface BudgetUsage {
  readonly service: string;
  readonly worstCaseDbConnections: number;
  readonly worstCaseRedisConnections: number;
}

export interface BudgetReport {
  readonly withinBudget: boolean;
  readonly dbUsed: number;
  readonly dbAvailable: number;
  readonly redisUsed: number;
  readonly redisAvailable: number;
  readonly perService: readonly BudgetUsage[];
  readonly violations: readonly string[];
}

/**
 * Worst Case je Dienst: **alle** Instanzen laufen und halten **jeweils** ihren
 * vollen Pool. Genau dieser Fall tritt bei einer Lastspitze ein — deshalb wird er
 * gerechnet und nicht der Durchschnitt.
 */
export function computeBudget(
  services: readonly ServiceCapacity[] = SERVICE_CAPACITY,
  limits: CapacityLimits = DEFAULT_LIMITS,
): BudgetReport {
  const perService = services.map((s) => ({
    service: s.service,
    worstCaseDbConnections: s.maxInstances * s.dbPoolSize,
    worstCaseRedisConnections: s.maxInstances * s.redisPoolSize,
  }));

  const dbUsed = perService.reduce((sum, s) => sum + s.worstCaseDbConnections, 0);
  const redisUsed = perService.reduce((sum, s) => sum + s.worstCaseRedisConnections, 0);
  const dbAvailable = limits.dbMaxConnections - limits.dbReservedConnections;
  const redisAvailable = limits.redisMaxConnections - limits.redisReservedConnections;

  const violations: string[] = [];
  if (dbUsed > dbAvailable) {
    violations.push(
      `DB-Verbindungsbudget überschritten: ${dbUsed} benötigt, ${dbAvailable} verfügbar ` +
        `(${limits.dbMaxConnections} max abzüglich ${limits.dbReservedConnections} Reserve).`,
    );
  }
  if (redisUsed > redisAvailable) {
    violations.push(
      `Redis-Verbindungsbudget überschritten: ${redisUsed} benötigt, ${redisAvailable} verfügbar.`,
    );
  }
  for (const s of services) {
    if (s.maxInstances <= 0) violations.push(`${s.service}: maxInstances muss positiv sein.`);
    if (s.concurrency <= 0) violations.push(`${s.service}: concurrency muss positiv sein.`);
    // 0 ist zulässig und bedeutet "kein Zugriff" (siehe ServiceCapacity.dbPoolSize).
    // Negativ ist immer ein Tippfehler und würde das Budget künstlich schrumpfen.
    if (s.dbPoolSize < 0) violations.push(`${s.service}: dbPoolSize darf nicht negativ sein.`);
    if (s.redisPoolSize < 0) violations.push(`${s.service}: redisPoolSize darf nicht negativ sein.`);
  }

  return {
    withinBudget: violations.length === 0,
    dbUsed,
    dbAvailable,
    redisUsed,
    redisAvailable,
    perService,
    violations,
  };
}

/**
 * Leitet ab, wie viele Instanzen ein Dienst höchstens haben **darf**, wenn ihm ein
 * bestimmter Anteil des Budgets zusteht. Das ist die Richtung, die Regel 9 meint:
 * von der Kapazität zur Instanzzahl, nicht umgekehrt.
 */
export function deriveMaxInstances(
  dbPoolSize: number,
  availableConnections: number,
): number {
  if (dbPoolSize <= 0) throw new Error('dbPoolSize muss positiv sein.');
  return Math.max(0, Math.floor(availableConnections / dbPoolSize));
}

export class CapacityBudgetError extends Error {
  readonly report: BudgetReport;
  constructor(report: BudgetReport) {
    super(`Kapazitätsbudget verletzt:\n- ${report.violations.join('\n- ')}`);
    this.name = 'CapacityBudgetError';
    this.report = report;
  }
}

/** Harte Variante für CI und Deploy-Gates. */
export function assertWithinBudget(
  services: readonly ServiceCapacity[] = SERVICE_CAPACITY,
  limits: CapacityLimits = DEFAULT_LIMITS,
): BudgetReport {
  const report = computeBudget(services, limits);
  if (!report.withinBudget) throw new CapacityBudgetError(report);
  return report;
}
