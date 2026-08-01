import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIMITS_MINOR,
  LimitType,
  MAX_PRIZE_CLOSED_BETA_MINOR,
  MIN_PRIZE_MINOR,
  effectiveLimitMinor,
  evaluateSpending,
  requestLimitChange,
  type SpendingLimit,
} from './spending-limits.js';
import {
  GuardedAction,
  PauseDuration,
  PauseScope,
  canRevokePause,
  isActionBlocked,
  isPauseActive,
  startPause,
} from './protection-pauses.js';
import {
  InterventionLevel,
  MAX_ACTIVE_RESERVATIONS,
  PushCategory,
  RiskSignal,
  TimeNotice,
  evaluateIntervention,
  evaluateParticipation,
  evaluateSessionTime,
  isQuietHour,
  maySendPush,
} from './risk-engine.js';

const T0 = new Date('2026-07-28T12:00:00Z');
const limit = (over: Partial<SpendingLimit> = {}): SpendingLimit => ({
  limitType: LimitType.DAILY,
  amountMinor: DEFAULT_LIMITS_MINOR.DAILY,
  effectiveAt: T0,
  ...over,
});

describe('Ausgabenlimits: Senkung sofort, Erhöhung mit Abkühlfrist', () => {
  it('senkt sofort', () => {
    const r = requestLimitChange(limit(), 2_000, T0);
    expect(r.kind).toBe('APPLIED_IMMEDIATELY');
    expect(effectiveLimitMinor(r.limit, T0)).toBe(2_000);
  });

  it('erhöht nicht sofort, sondern terminiert', () => {
    const r = requestLimitChange(limit(), 20_000, T0);
    expect(r.kind).toBe('SCHEDULED');
    // Vor Ablauf gilt weiterhin das alte, niedrigere Limit.
    expect(effectiveLimitMinor(r.limit, T0)).toBe(DEFAULT_LIMITS_MINOR.DAILY);
    const justBefore = new Date(T0.getTime() + 24 * 60 * 60 * 1000 - 1);
    expect(effectiveLimitMinor(r.limit, justBefore)).toBe(DEFAULT_LIMITS_MINOR.DAILY);
  });

  it('lässt die Erhöhung erst nach 24 Stunden wirken', () => {
    const r = requestLimitChange(limit(), 20_000, T0);
    const after = new Date(T0.getTime() + 24 * 60 * 60 * 1000);
    expect(effectiveLimitMinor(r.limit, after)).toBe(20_000);
  });

  it('verwirft eine noch nicht wirksame Erhöhung bei erneuter Senkung', () => {
    const scheduled = requestLimitChange(limit(), 20_000, T0).limit;
    const lowered = requestLimitChange(scheduled, 1_000, T0);
    expect(lowered.kind).toBe('APPLIED_IMMEDIATELY');
    const muchLater = new Date(T0.getTime() + 10 * 24 * 60 * 60 * 1000);
    expect(effectiveLimitMinor(lowered.limit, muchLater)).toBe(1_000);
  });
});

describe('Ausgabenentscheidung', () => {
  it('erlaubt eine Zahlung innerhalb aller Fenster', () => {
    const d = evaluateSpending(5_000, [{ spentMinor: 0, limit: limit() }], T0);
    expect(d.allowed).toBe(true);
  });

  it('blockiert, sobald ein einziges Fenster überschritten würde', () => {
    const d = evaluateSpending(5_000, [
      { spentMinor: 0, limit: limit() },
      { spentMinor: 24_000, limit: limit({ limitType: LimitType.WEEKLY, amountMinor: DEFAULT_LIMITS_MINOR.WEEKLY }) },
    ], T0);
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.reasonCode).toBe('LIMIT_EXCEEDED');
      expect(d.limitType).toBe(LimitType.WEEKLY);
    }
  });

  it('erzwingt Mindest- und Höchstpreisgeld', () => {
    const tooLow = evaluateSpending(MIN_PRIZE_MINOR - 1, [], T0);
    expect(tooLow.allowed).toBe(false);
    const tooHigh = evaluateSpending(MAX_PRIZE_CLOSED_BETA_MINOR + 1, [], T0);
    expect(tooHigh.allowed).toBe(false);
  });

  it('nutzt bei offener Erhöhung weiterhin das niedrigere Limit', () => {
    const scheduled = requestLimitChange(limit({ amountMinor: 5_000 }), 20_000, T0).limit;
    const d = evaluateSpending(6_000, [{ spentMinor: 0, limit: scheduled }], T0);
    expect(d.allowed).toBe(false);
  });
});

describe('Schutzpausen', () => {
  it('greift sofort', () => {
    const p = startPause(PauseScope.MONEY, PauseDuration.DAYS_7, T0);
    expect(isPauseActive(p, T0)).toBe(true);
  });

  it('lässt eine 7-Tage-Pause nicht vorzeitig aufheben', () => {
    const p = startPause(PauseScope.MONEY, PauseDuration.DAYS_7, T0);
    const r = canRevokePause(p, PauseDuration.DAYS_7, new Date(T0.getTime() + 60_000));
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reasonCode).toBe('FIXED_TERM_NOT_REVOCABLE');
  });

  it('lässt eine 30-Tage-Pause nicht vorzeitig aufheben', () => {
    const p = startPause(PauseScope.FULL, PauseDuration.DAYS_30, T0);
    const r = canRevokePause(p, PauseDuration.DAYS_30, new Date(T0.getTime() + 20 * 86_400_000));
    expect(r.allowed).toBe(false);
  });

  it('macht eine unbefristete Pause erst nach sieben Tagen aufhebbar', () => {
    const p = startPause(PauseScope.FULL, PauseDuration.INDEFINITE, T0);
    const early = canRevokePause(p, PauseDuration.INDEFINITE, new Date(T0.getTime() + 86_400_000));
    expect(early.allowed).toBe(false);
    if (!early.allowed) expect(early.reasonCode).toBe('COOL_OFF_ACTIVE');

    const late = canRevokePause(p, PauseDuration.INDEFINITE, new Date(T0.getTime() + 8 * 86_400_000));
    expect(late.allowed).toBe(true);
  });

  it('läuft befristet aus, ohne Zutun', () => {
    const p = startPause(PauseScope.MONEY, PauseDuration.HOURS_24, T0);
    expect(isPauseActive(p, new Date(T0.getTime() + 25 * 3_600_000))).toBe(false);
  });

  it('blockiert Geldaktionen während einer Geld-Pause', () => {
    const p = [startPause(PauseScope.MONEY, PauseDuration.DAYS_7, T0)];
    expect(isActionBlocked(p, GuardedAction.FUND_CHALLENGE, T0)).toBe(true);
    expect(isActionBlocked(p, GuardedAction.CREATE_MONEY_CHALLENGE, T0)).toBe(true);
  });

  it('hält bestehende Auszahlungsansprüche immer zugänglich', () => {
    const p = [startPause(PauseScope.FULL, PauseDuration.INDEFINITE, T0)];
    expect(isActionBlocked(p, GuardedAction.CLAIM_EXISTING_PAYOUT, T0)).toBe(false);
  });

  it('unterdrückt Reaktivierungs-Pushes während der Pause', () => {
    const p = [startPause(PauseScope.FULL, PauseDuration.DAYS_30, T0)];
    expect(isActionBlocked(p, GuardedAction.RECEIVE_MARKETING_PUSH, T0)).toBe(true);
  });
});

describe('Risk Engine', () => {
  it('interveniert ohne Signale nicht', () => {
    expect(evaluateIntervention([]).level).toBe(InterventionLevel.LEVEL_0_NORMAL);
  });

  it('informiert bei einem leichten Signal', () => {
    expect(evaluateIntervention([RiskSignal.VERY_LONG_SESSION]).level).toBe(
      InterventionLevel.LEVEL_1_INFORMATION,
    );
  });

  it('erzeugt Reibung bei einem schweren Geldsignal', () => {
    const d = evaluateIntervention([RiskSignal.SPENDING_SPIKE]);
    expect(d.level).toBe(InterventionLevel.LEVEL_2_FRICTION);
    expect(d.requiresExtraConfirmation).toBe(true);
  });

  it('sperrt Limit-Erhöhungen ab Stufe 3', () => {
    const d = evaluateIntervention([RiskSignal.SPENDING_SPIKE, RiskSignal.RAPID_REPEAT_PAYMENTS]);
    expect(d.level).toBe(InterventionLevel.LEVEL_3_COOL_OFF_RECOMMENDED);
    expect(d.limitIncreaseBlocked).toBe(true);
  });

  it('setzt bei massiver Häufung einen Money-Hold mit menschlicher Prüfung', () => {
    const d = evaluateIntervention([
      RiskSignal.SPENDING_SPIKE,
      RiskSignal.RAPID_REPEAT_PAYMENTS,
      RiskSignal.REPEATED_LIMIT_INCREASE_ATTEMPTS,
    ]);
    expect(d.level).toBe(InterventionLevel.LEVEL_4_TEMPORARY_MONEY_HOLD);
    expect(d.moneyHold).toBe(true);
    expect(d.humanReviewRequired).toBe(true);
  });

  it('zählt wiederholt gemeldete Signale nur einmal', () => {
    const d = evaluateIntervention([RiskSignal.VERY_LONG_SESSION, RiskSignal.VERY_LONG_SESSION]);
    expect(d.triggerCodes).toHaveLength(1);
    expect(d.level).toBe(InterventionLevel.LEVEL_1_INFORMATION);
  });
});

describe('Nutzungszeit und Ruhezeiten', () => {
  it('meldet sich nach 20 und unterbricht nach 45 Minuten', () => {
    expect(evaluateSessionTime(5)).toBe(TimeNotice.NONE);
    expect(evaluateSessionTime(20)).toBe(TimeNotice.GENTLE);
    expect(evaluateSessionTime(46)).toBe(TimeNotice.INTERRUPT);
  });

  it('erkennt die über Mitternacht laufende Ruhezeit', () => {
    expect(isQuietHour(23)).toBe(true);
    expect(isQuietHour(3)).toBe(true);
    expect(isQuietHour(7)).toBe(true);
    expect(isQuietHour(8)).toBe(false);
    expect(isQuietHour(14)).toBe(false);
  });

  it('blockiert Marketing- und Finanz-Pushes in der Nacht', () => {
    expect(maySendPush(PushCategory.MARKETING, 23)).toBe(false);
    expect(maySendPush(PushCategory.FINANCIAL, 2)).toBe(false);
  });

  it('lässt zeitkritische und sicherheitsrelevante Pushes zu', () => {
    expect(maySendPush(PushCategory.TRANSACTIONAL, 23)).toBe(true);
    expect(maySendPush(PushCategory.SAFETY, 3)).toBe(true);
  });

  it('respektiert eine Benachrichtigungspause auch tagsüber', () => {
    expect(maySendPush(PushCategory.MARKETING, 14, { notificationsPaused: true })).toBe(false);
    // Sicherheitshinweise bleiben auch dann zustellbar.
    expect(maySendPush(PushCategory.SAFETY, 14, { notificationsPaused: true })).toBe(true);
  });
});

describe('Teilnehmerschutz', () => {
  it('begrenzt gleichzeitige Reservierungen auf drei', () => {
    const d = evaluateParticipation({ activeReservations: MAX_ACTIVE_RESERVATIONS, participationsToday: 0 });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reasonCode).toBe('TOO_MANY_ACTIVE_RESERVATIONS');
  });

  it('begrenzt Teilnahmen pro Tag', () => {
    const d = evaluateParticipation({ activeReservations: 0, participationsToday: 5 });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reasonCode).toBe('DAILY_PARTICIPATION_LIMIT');
  });

  it('erlaubt den Normalfall', () => {
    expect(evaluateParticipation({ activeReservations: 1, participationsToday: 2 }).allowed).toBe(true);
  });
});
