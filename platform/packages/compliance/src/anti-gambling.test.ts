import { describe, expect, it } from 'vitest';
import {
  ALLOWED_DECISION_SOURCES,
  AntiGamblingInvariantError,
  FORBIDDEN_PRODUCTION_FLAGS,
  assertAntiGamblingInvariants,
  checkAntiGamblingInvariants,
  checkDecisionSource,
  checkForbiddenFlags,
  checkNoRewagering,
  checkParticipantCharge,
  checkPrizeFunding,
} from './anti-gambling.js';

/**
 * Glücksspiel-Abgrenzungstests (§39). Diese Suite ist bewusst hart: Sie beschreibt
 * Produktzustände, die niemals eintreten dürfen. Schlägt hier etwas fehl, ist das
 * Geschäftsmodell betroffen — nicht nur ein Feature.
 */
describe('Anti-Glücksspiel: kein Teilnehmerentgelt', () => {
  it('lehnt jede Teilnehmergebühr ab', () => {
    const violations = checkParticipantCharge({ amountMinor: 100, purpose: 'Teilnahme' });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.code).toBe('PARTICIPANT_CHARGED');
  });

  it('lehnt auch kleinste Beträge ab', () => {
    expect(checkParticipantCharge({ amountMinor: 1, purpose: 'Extra-Versuch' })).toHaveLength(1);
  });

  it('erlaubt den entgeltfreien Fall', () => {
    expect(checkParticipantCharge({ amountMinor: 0, purpose: 'Teilnahme' })).toHaveLength(0);
  });

  it('bildet Preisgeld nicht aus Teilnehmergeldern', () => {
    const violations = checkPrizeFunding(['PARTICIPANT_FEES']);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.code).toBe('PRIZE_FUNDED_BY_DISALLOWED_SOURCE');
  });

  it('lehnt Pooling ab, auch wenn zusätzlich der Ersteller zahlt', () => {
    expect(checkPrizeFunding(['CREATOR_CHARGE', 'PARTICIPANT_FEES'])).toHaveLength(1);
  });

  it('erlaubt Ersteller- und Sponsorenfinanzierung', () => {
    expect(checkPrizeFunding(['CREATOR_CHARGE'])).toHaveLength(0);
    expect(checkPrizeFunding(['PLATFORM_SPONSORSHIP', 'BRAND_SPONSORSHIP'])).toHaveLength(0);
  });
});

describe('Anti-Glücksspiel: keine Zufallsbestimmung', () => {
  it('akzeptiert keine Zufallsquelle als Gewinnerentscheidung', () => {
    const violations = checkDecisionSource('RANDOM');
    expect(violations).toHaveLength(1);
    expect(violations[0]?.code).toBe('RANDOM_OR_UNKNOWN_DECISION_SOURCE');
  });

  it('akzeptiert keine Lotterie- oder Jackpot-Quelle', () => {
    for (const source of ['LOTTERY', 'JACKPOT', 'WHEEL_OF_FORTUNE', 'MYSTERY_BOX']) {
      expect(checkDecisionSource(source), source).toHaveLength(1);
    }
  });

  it('erlaubt ausschließlich die drei leistungsbasierten Quellen', () => {
    for (const source of ALLOWED_DECISION_SOURCES) {
      expect(checkDecisionSource(source), source).toHaveLength(0);
    }
    expect(ALLOWED_DECISION_SOURCES).toEqual(['CREATOR_DECIDES', 'COMMUNITY_VOTE', 'AUTO_FALLBACK']);
  });
});

describe('Anti-Glücksspiel: kein Rewagering', () => {
  it('verbietet Wetten, Einsätze und Verdopplung', () => {
    for (const kind of ['STAKE', 'BET', 'DOUBLE_OR_NOTHING']) {
      expect(checkNoRewagering({ kind, sourceIsPrize: true }), kind).toHaveLength(1);
    }
  });

  it('verbietet den Kauf von Stimmen und Gewinnchancen', () => {
    expect(checkNoRewagering({ kind: 'BUY_VOTES', sourceIsPrize: false })).toHaveLength(1);
    expect(checkNoRewagering({ kind: 'BUY_CHANCE', sourceIsPrize: false })).toHaveLength(1);
  });

  it('verbietet die Umwandlung einer Auszahlung in Plattform-Coins', () => {
    const violations = checkNoRewagering({ kind: 'CONVERT_TO_COINS', sourceIsPrize: true });
    expect(violations[0]?.code).toBe('REWAGERING_ATTEMPTED');
  });

  it('verbietet, einen Gewinn direkt als Finanzierung neuer Gewinnchancen einzusetzen', () => {
    const violations = checkNoRewagering({ kind: 'FUND_CHALLENGE', sourceIsPrize: true });
    expect(violations[0]?.code).toBe('PRIZE_USED_TO_FUND_CHALLENGE');
  });

  it('erlaubt eine reguläre Challenge-Finanzierung aus eigenem Geld', () => {
    expect(checkNoRewagering({ kind: 'FUND_CHALLENGE', sourceIsPrize: false })).toHaveLength(0);
  });
});

describe('Anti-Glücksspiel: verbotene Produktionsflags', () => {
  it('erkennt jedes einzelne verbotene Flag', () => {
    for (const flag of FORBIDDEN_PRODUCTION_FLAGS) {
      expect(checkForbiddenFlags({ [flag]: true }), flag).toHaveLength(1);
    }
  });

  it('erkennt auch die String-Variante "true" aus Umgebungsvariablen', () => {
    expect(checkForbiddenFlags({ RANDOM_WINNERS_ENABLED: 'true' })).toHaveLength(1);
  });

  it('behandelt fehlende Flags als sicher deaktiviert', () => {
    expect(checkForbiddenFlags({})).toHaveLength(0);
    expect(checkForbiddenFlags({ RANDOM_WINNERS_ENABLED: false })).toHaveLength(0);
  });

  it('deckt genau die fünf Kernverbote ab', () => {
    expect([...FORBIDDEN_PRODUCTION_FLAGS].sort()).toEqual([
      'LOOTBOXES_ENABLED',
      'MINOR_REAL_MONEY_ACCESS',
      'PARTICIPANT_ENTRY_FEES_ENABLED',
      'RANDOM_WINNERS_ENABLED',
      'REWAGERING_ENABLED',
    ]);
  });
});

describe('Anti-Glücksspiel: Gesamtprüfung', () => {
  it('wirft bei jeder Verletzung und nennt alle Codes', () => {
    expect(() =>
      assertAntiGamblingInvariants({
        flags: { RANDOM_WINNERS_ENABLED: true },
        decisionSource: 'RANDOM',
        participantCharge: { amountMinor: 500, purpose: 'Einsatz' },
      }),
    ).toThrow(AntiGamblingInvariantError);

    const violations = checkAntiGamblingInvariants({
      flags: { RANDOM_WINNERS_ENABLED: true },
      decisionSource: 'RANDOM',
      participantCharge: { amountMinor: 500, purpose: 'Einsatz' },
    });
    expect(violations.map((v) => v.code)).toEqual([
      'FORBIDDEN_FLAG_RANDOM_WINNERS_ENABLED',
      'PARTICIPANT_CHARGED',
      'RANDOM_OR_UNKNOWN_DECISION_SOURCE',
    ]);
  });

  it('lässt den regulären, zulässigen Produktzustand passieren', () => {
    expect(() =>
      assertAntiGamblingInvariants({
        flags: {
          PARTICIPANT_ENTRY_FEES_ENABLED: false,
          RANDOM_WINNERS_ENABLED: false,
          REWAGERING_ENABLED: false,
          LOOTBOXES_ENABLED: false,
          MINOR_REAL_MONEY_ACCESS: false,
        },
        prizeFundingSources: ['CREATOR_CHARGE'],
        participantCharge: { amountMinor: 0, purpose: 'Teilnahme' },
        decisionSource: 'COMMUNITY_VOTE',
        operation: { kind: 'FUND_CHALLENGE', sourceIsPrize: false },
      }),
    ).not.toThrow();
  });

  it('bietet keinen Override-Parameter an', () => {
    // Der Vertrag ist bewusst eng: assert nimmt genau einen Kontext und kein
    // "force"/"skip"-Flag entgegen. Ein Agent kann die Prüfung nicht wegkonfigurieren.
    expect(assertAntiGamblingInvariants).toHaveLength(1);
  });
});
