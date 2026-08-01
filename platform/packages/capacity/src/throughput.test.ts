import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  DEFAULT_TARGET_LOAD,
  PROCESSORS,
  ThroughputBudgetError,
  assertThroughput,
  computeThroughput,
  deriveBatchSize,
  ratePerMinute,
  type BatchProcessor,
} from './throughput.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * Pflichttest für das Durchsatzbudget.
 *
 * Der Anlass steht im Testnamen weiter unten: Die Beweisprüfung lief mit
 * Batchgröße 20 alle fünf Minuten — 4 Einsendungen pro Minute. Kein Test hat das
 * bemerkt, weil kein Test danach gefragt hat. Dieser fragt.
 */
describe('Durchsatz der tatsächlichen Konfiguration', () => {
  it('trägt die Zielrate', () => {
    const report = computeThroughput(PROCESSORS);
    expect(report.violations).toEqual([]);
    expect(report.withinBudget).toBe(true);
  });

  it('legt jeden Verarbeiter mit Puffer aus, nicht auf Kante', () => {
    // Eine Auslegung, die die Zielrate exakt trifft, hat bei der ersten Abweichung
    // keinen Spielraum — und Rückstand baut sich schneller auf als ab.
    expect(DEFAULT_TARGET_LOAD.headroomFactor).toBeGreaterThanOrEqual(2);
  });

  it('hat für jeden Verarbeiter eine Zielrate hinterlegt', () => {
    // Ein Verarbeiter ohne Zielrate ist nicht ausgelegt, sondern geraten.
    const report = computeThroughput(PROCESSORS);
    expect(report.requirements.map((r) => r.processor).sort()).toEqual(
      PROCESSORS.map((p) => p.name).sort(),
    );
  });
});

describe('Die Decke, an der die erste Auslegung gescheitert ist', () => {
  const alteBeweispruefung: BatchProcessor = {
    name: 'evidence-verification',
    batchSize: 20,
    intervalSeconds: 300,
    parallelism: 1,
    drainsFully: false,
  };

  it('rechnet die alte Konfiguration auf 4 Einsendungen pro Minute herunter', () => {
    expect(ratePerMinute(alteBeweispruefung)).toBe(4);
  });

  it('hätte die alte Konfiguration abgelehnt', () => {
    const report = computeThroughput([alteBeweispruefung]);
    expect(report.withinBudget).toBe(false);
    expect(report.violations[0]).toContain('schafft 4/min');
    expect(report.violations[0]).toContain('wächst der Rückstand unbegrenzt');
  });

  it('wirft in der harten Variante', () => {
    expect(() => assertThroughput([alteBeweispruefung])).toThrow(ThroughputBudgetError);
  });
});

describe('Ableitung statt Vermutung', () => {
  it('leitet die Batchgröße aus Zielrate und Takt ab', () => {
    // 240/min bei Takt 60s und einem Läufer → 240 je Lauf.
    expect(deriveBatchSize(240, 60, 1)).toBe(240);
    // Derselbe Bedarf auf zwei parallele Läufer verteilt.
    expect(deriveBatchSize(240, 60, 2)).toBe(120);
    // Häufigerer Takt senkt die nötige Stapelgröße.
    expect(deriveBatchSize(240, 30, 1)).toBe(120);
  });

  it('rundet auf statt ab — lieber ein Element zu viel je Lauf', () => {
    expect(deriveBatchSize(100, 60, 3)).toBe(34); // 33,33 → 34
  });

  it('behandelt einen vollständig leerenden Lauf nicht als begrenzt', () => {
    // `drain()` wiederholt den Stapel bis zur Erschöpfung; die Batchgröße ist dann
    // nur Stückelung, keine Decke.
    expect(
      ratePerMinute({
        name: 'x',
        batchSize: 1,
        intervalSeconds: 3600,
        parallelism: 1,
        drainsFully: true,
      }),
    ).toBe(Number.POSITIVE_INFINITY);
  });

  it('lehnt unsinnige Eingaben ab', () => {
    expect(() => deriveBatchSize(100, 0)).toThrow();
    expect(() => deriveBatchSize(100, 60, 0)).toThrow();
  });
});

describe('Arbeit ohne Verarbeiter fällt nicht unter den Tisch', () => {
  it('meldet einen Bedarfsposten, für den niemand zuständig ist', () => {
    // Der gefährlichere Fall als ein zu kleiner Stapel: Die Arbeit fällt an, und
    // niemand holt sie ab. Nichts würde das melden.
    const report = computeThroughput([]);
    expect(report.violations.some((v) => v.includes('kein Verarbeiter konfiguriert'))).toBe(true);
  });

  it('meldet einen Verarbeiter ohne Zielrate', () => {
    const report = computeThroughput([
      { name: 'unbekannt', batchSize: 10, intervalSeconds: 60, parallelism: 1, drainsFully: false },
    ]);
    expect(report.violations.some((v) => v.includes('keine Zielrate'))).toBe(true);
  });
});

describe('Code und Konfiguration laufen nicht auseinander', () => {
  it('leitet die Batchgröße der Beweisprüfung ab, statt sie zu setzen', () => {
    // Die eigentliche Invariante ist nicht eine bestimmte Zahl, sondern dass
    // überhaupt abgeleitet wird. Eine Handzahl kann wieder zu klein sein — eine
    // abgeleitete kann es nur, wenn sich die Zielrate ändert, und dann schlägt
    // der Test oben fehl.
    const quelle = readFileSync(
      join(root, 'apps', 'api', 'src', 'operations', 'process-evidence.ts'),
      'utf8',
    );
    expect(quelle).toContain('deriveBatchSize(');
    expect(quelle, 'kein Zahlen-Literal als Standard-Batchgröße').not.toMatch(
      /batchSize\s*=\s*\d+/,
    );

    const konfiguriert = PROCESSORS.find((p) => p.name === 'evidence-verification');
    expect(konfiguriert?.batchSize).toBe(
      deriveBatchSize(
        DEFAULT_TARGET_LOAD.submissionsPerMinute * DEFAULT_TARGET_LOAD.headroomFactor,
        konfiguriert?.intervalSeconds ?? 0,
        konfiguriert?.parallelism ?? 1,
      ),
    );
  });

  it('spiegelt den Takt der Beweisprüfung im Terraform-Zeitplan', () => {
    const tf = readFileSync(
      join(root, 'infrastructure', 'terraform', 'variables.tf'),
      'utf8',
    );
    const p = PROCESSORS.find((x) => x.name === 'evidence-verification');
    const takt = p?.intervalSeconds ?? 0;
    // 60s entspricht "* * * * *"; alles andere müsste hier ergänzt werden.
    expect(takt, 'nur der Minutentakt ist hier abgebildet').toBe(60);
    const zeile = tf.split('\n').find((l) => l.includes('"worker-sweeps"'));
    expect(zeile, 'worker-sweeps fehlt in var.worker_schedules').toBeDefined();
    expect(zeile).toContain('"* * * * *"');
  });

  it('spiegelt die Parallelität des Publishers in Terraform', () => {
    // Die Kapazitätstabelle budgetierte vier Publisher, Terraform startete einen.
    // Genau diese Verwechslung von "budgetiert" und "läuft" wird hier festgehalten.
    const tf = readFileSync(join(root, 'infrastructure', 'terraform', 'cloud-run.tf'), 'utf8');
    const p = PROCESSORS.find((x) => x.name === 'outbox-publisher');
    expect(tf).toContain(`worker_parallelism`);
    expect(p?.parallelism).toBeGreaterThan(1);
  });
});
