import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CapacityBudgetError,
  DEFAULT_LIMITS,
  SERVICE_CAPACITY,
  assertWithinBudget,
  computeBudget,
  deriveMaxInstances,
  type ServiceCapacity,
} from './index.js';

/**
 * Pflichttest für das Verbindungsbudget (Scale S1, Aufgabe 13).
 *
 * Der Test existiert, damit eine erhöhte `max_instances` nicht unbemerkt die
 * Datenbank aussperrt. Er ist bewusst hart: Ein überschrittenes Budget ist kein
 * Warnhinweis, sondern ein roter Build.
 */
describe('Verbindungsbudget der tatsächlichen Konfiguration', () => {
  it('hält das DB-Budget ein', () => {
    const report = computeBudget();
    expect(report.violations).toEqual([]);
    expect(report.withinBudget).toBe(true);
    expect(report.dbUsed).toBeLessThanOrEqual(report.dbAvailable);
  });

  it('hält das Redis-Budget ein', () => {
    const report = computeBudget();
    expect(report.redisUsed).toBeLessThanOrEqual(report.redisAvailable);
  });

  it('lässt eine Reserve für Migrationen und Diagnose frei', () => {
    // Ohne diese Reserve sperrt man sich im Ernstfall selbst aus.
    expect(DEFAULT_LIMITS.dbReservedConnections).toBeGreaterThan(0);
    const report = computeBudget();
    expect(report.dbAvailable).toBe(
      DEFAULT_LIMITS.dbMaxConnections - DEFAULT_LIMITS.dbReservedConnections,
    );
  });

  it('rechnet den Worst Case, nicht den Durchschnitt', () => {
    const report = computeBudget();
    for (const s of SERVICE_CAPACITY) {
      const usage = report.perService.find((u) => u.service === s.service);
      // Alle Instanzen laufen und halten jeweils den vollen Pool.
      expect(usage?.worstCaseDbConnections).toBe(s.maxInstances * s.dbPoolSize);
    }
  });

  it('lässt für Wachstum Luft, ohne das Limit auszureizen', () => {
    const report = computeBudget();
    const auslastung = report.dbUsed / report.dbAvailable;
    // Reines Frühwarnsignal: Wer über 85 % geht, sollte die DB skalieren statt
    // weitere Instanzen zu erlauben.
    expect(auslastung).toBeLessThanOrEqual(0.85);
  });
});

describe('Budgetverletzungen werden erkannt', () => {
  const over: ServiceCapacity[] = [
    { service: 'api', maxInstances: 100, concurrency: 80, dbPoolSize: 10, redisPoolSize: 0 },
  ];

  it('meldet ein überschrittenes DB-Budget', () => {
    const report = computeBudget(over);
    expect(report.withinBudget).toBe(false);
    expect(report.violations[0]).toContain('DB-Verbindungsbudget überschritten');
  });

  it('wirft in der harten Variante', () => {
    expect(() => assertWithinBudget(over)).toThrow(CapacityBudgetError);
  });

  it('meldet ein überschrittenes Redis-Budget', () => {
    const report = computeBudget([
      { service: 'api', maxInstances: 50, concurrency: 80, dbPoolSize: 1, redisPoolSize: 50 },
    ]);
    expect(report.violations.some((v) => v.includes('Redis'))).toBe(true);
  });

  it('lehnt unsinnige Werte ab', () => {
    const report = computeBudget([
      { service: 'x', maxInstances: 0, concurrency: 0, dbPoolSize: 0, redisPoolSize: 0 },
    ]);
    expect(report.violations.length).toBeGreaterThanOrEqual(3);
  });
});

describe('Ableitung der Instanzzahl aus der Kapazität (Regel 9)', () => {
  it('leitet von verfügbaren Verbindungen zur Instanzzahl ab', () => {
    expect(deriveMaxInstances(5, 180)).toBe(36);
    expect(deriveMaxInstances(4, 180)).toBe(45);
  });

  it('rundet ab statt auf — lieber eine Instanz weniger', () => {
    expect(deriveMaxInstances(7, 100)).toBe(14); // 14,28 → 14
  });

  it('lehnt eine unsinnige Poolgröße ab', () => {
    expect(() => deriveMaxInstances(0, 100)).toThrow();
  });
});

describe('Terraform und Code laufen nicht auseinander', () => {
  it('spiegelt jede Dienstkonfiguration identisch in den tfvars', () => {
    // Terraform darf keine eigenen Zahlen führen: Sonst skaliert die Infrastruktur
    // anders als das Budget, das hier geprüft wird.
    const path = new URL(
      '../../../infrastructure/terraform/capacity.auto.tfvars.json',
      import.meta.url,
    ).pathname;
    const tfvars = JSON.parse(readFileSync(path, 'utf8')) as {
      services: Record<
        string,
        { max_instances: number; concurrency: number; db_pool_size: number; redis_pool_size: number }
      >;
      db_max_connections: number;
      db_reserved_connections: number;
    };

    expect(Object.keys(tfvars.services).sort()).toEqual(
      SERVICE_CAPACITY.map((s) => s.service).sort(),
    );
    for (const s of SERVICE_CAPACITY) {
      const tf = tfvars.services[s.service]!;
      expect(tf.max_instances, `${s.service}.max_instances`).toBe(s.maxInstances);
      expect(tf.concurrency, `${s.service}.concurrency`).toBe(s.concurrency);
      expect(tf.db_pool_size, `${s.service}.db_pool_size`).toBe(s.dbPoolSize);
      expect(tf.redis_pool_size, `${s.service}.redis_pool_size`).toBe(s.redisPoolSize);
    }
    expect(tfvars.db_max_connections).toBe(DEFAULT_LIMITS.dbMaxConnections);
    expect(tfvars.db_reserved_connections).toBe(DEFAULT_LIMITS.dbReservedConnections);
  });
});
