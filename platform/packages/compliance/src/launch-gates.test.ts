import { describe, expect, it } from 'vitest';
import {
  GatedFeature,
  LaunchStage,
  LegalGateStatus,
  REQUIRED_LIVE_ASSESSMENTS,
  applyMaterialChange,
  evaluateGate,
  evaluateLiveReadiness,
  type LaunchGate,
} from './launch-gates.js';
import { evaluateRollout, StopTheLineCondition } from './stop-the-line.js';

const gate = (over: Partial<LaunchGate> = {}): LaunchGate => ({
  jurisdiction: 'DE',
  feature: GatedFeature.REAL_MONEY,
  status: LegalGateStatus.APPROVED_FOR_GERMANY_LIVE,
  ...over,
});

describe('Legal Launch Gates', () => {
  it('sperrt fail-closed, wenn gar kein Gate existiert', () => {
    const d = evaluateGate(undefined, LaunchStage.SANDBOX);
    expect(d.allowed).toBe(false);
    expect(d.reasonCode).toBe('GATE_MISSING');
  });

  it('lässt Echtgeld live nur mit APPROVED_FOR_GERMANY_LIVE zu', () => {
    expect(evaluateGate(gate(), LaunchStage.GERMANY_LIVE).allowed).toBe(true);
    expect(
      evaluateGate(gate({ status: LegalGateStatus.APPROVED_FOR_CLOSED_BETA }), LaunchStage.GERMANY_LIVE)
        .allowed,
    ).toBe(false);
  });

  it('behandelt NOT_ASSESSED und ASSESSMENT_REQUIRED als unzureichend', () => {
    for (const status of [LegalGateStatus.NOT_ASSESSED, LegalGateStatus.ASSESSMENT_REQUIRED]) {
      const d = evaluateGate(gate({ status }), LaunchStage.SANDBOX);
      expect(d.allowed, status).toBe(false);
      expect(d.reasonCode).toBe('GATE_INSUFFICIENT_FOR_STAGE');
    }
  });

  it('hält ein BLOCKED-Gate auch in der Sandbox geschlossen', () => {
    const d = evaluateGate(gate({ status: LegalGateStatus.BLOCKED }), LaunchStage.SANDBOX);
    expect(d.allowed).toBe(false);
    expect(d.reasonCode).toBe('GATE_BLOCKED');
  });

  it('wertet abgelaufene Freigaben als nicht erteilt', () => {
    const d = evaluateGate(
      gate({ expiresAt: new Date('2026-01-01T00:00:00Z') }),
      LaunchStage.GERMANY_LIVE,
      new Date('2026-07-28T00:00:00Z'),
    );
    expect(d.allowed).toBe(false);
    expect(d.reasonCode).toBe('GATE_EXPIRED');
  });

  it('erlaubt eine Live-Freigabe auch auf niedrigeren Stufen', () => {
    expect(evaluateGate(gate(), LaunchStage.SANDBOX).allowed).toBe(true);
    expect(evaluateGate(gate(), LaunchStage.CLOSED_BETA).allowed).toBe(true);
  });
});

describe('Wesentliche Änderungen erzwingen Neubewertung', () => {
  it('wirft eine erteilte Live-Freigabe auf REASSESSMENT_REQUIRED zurück', () => {
    const changed = applyMaterialChange(gate());
    expect(changed.status).toBe(LegalGateStatus.REASSESSMENT_REQUIRED);
    expect(evaluateGate(changed, LaunchStage.GERMANY_LIVE).allowed).toBe(false);
  });

  it('hebt eine Blockade nicht versehentlich auf', () => {
    const blocked = gate({ status: LegalGateStatus.BLOCKED });
    expect(applyMaterialChange(blocked).status).toBe(LegalGateStatus.BLOCKED);
  });
});

describe('Live-Readiness', () => {
  it('verlangt alle zehn Gutachten', () => {
    expect(REQUIRED_LIVE_ASSESSMENTS).toHaveLength(10);
    const partial = evaluateLiveReadiness(['GAMBLING_CLASSIFICATION', 'DSA_PLATFORM_ANALYSIS']);
    expect(partial.ready).toBe(false);
    expect(partial.missing).toHaveLength(8);
  });

  it('ist erst mit vollständiger Liste bereit', () => {
    expect(evaluateLiveReadiness([...REQUIRED_LIVE_ASSESSMENTS]).ready).toBe(true);
  });

  it('ist ohne jedes Gutachten nicht bereit', () => {
    expect(evaluateLiveReadiness([]).ready).toBe(false);
  });
});

describe('Stop-the-Line', () => {
  it('läuft ohne Signale normal weiter', () => {
    expect(evaluateRollout([]).halted).toBe(false);
  });

  it('stoppt bereits bei einem einzigen Signal', () => {
    const d = evaluateRollout([
      { condition: StopTheLineCondition.DOUBLE_PAYOUT, detectedAt: new Date() },
    ]);
    expect(d.halted).toBe(true);
    expect(d.conditions).toEqual([StopTheLineCondition.DOUBLE_PAYOUT]);
  });

  it('stoppt bei durchbrochener Zehn-Plätze-Grenze', () => {
    const d = evaluateRollout([
      { condition: StopTheLineCondition.ELEVENTH_SLOT_RESERVED, detectedAt: new Date() },
    ]);
    expect(d.halted).toBe(true);
  });

  it('fasst mehrfach gemeldete Bedingungen zusammen', () => {
    const d = evaluateRollout([
      { condition: StopTheLineCondition.MINOR_REAL_MONEY_ACCESS, detectedAt: new Date() },
      { condition: StopTheLineCondition.MINOR_REAL_MONEY_ACCESS, detectedAt: new Date() },
      { condition: StopTheLineCondition.APPEAL_PATH_BROKEN, detectedAt: new Date() },
    ]);
    expect(d.conditions).toHaveLength(2);
  });
});
