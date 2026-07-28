import { describe, expect, it } from 'vitest';
import { Category, PolicyCode } from './policy-codes.js';
import { RiskLevel, evaluateChallengePolicy, type ChallengeDraft } from './policy-engine.js';

const draft = (over: Partial<ChallengeDraft> = {}): ChallengeDraft => ({
  title: 'Zeig deinen saubersten Basketball-Freiwurf',
  description: 'Fünf Positionen, sichere Umgebung, eigenes Tempo.',
  category: Category.SPORT_SKILLS,
  ...over,
});

describe('Policy Engine: harmlose Challenges', () => {
  it('lässt eine unbedenkliche Sport-Challenge als LOW durch', () => {
    const r = evaluateChallengePolicy(draft());
    expect(r.riskLevel).toBe(RiskLevel.LOW);
    expect(r.prohibited).toBe(false);
    expect(r.requiresManualReview).toBe(false);
  });

  it('lässt eine Kreativ-Challenge passieren', () => {
    const r = evaluateChallengePolicy(
      draft({
        title: 'Zeichne in zehn Minuten ein Tier aus drei Formen',
        description: 'Nur Papier und Stift.',
        category: Category.CREATIVITY_ART,
      }),
    );
    expect(r.riskLevel).toBe(RiskLevel.LOW);
  });
});

describe('Policy Engine: verbotene Inhalte (§14.1)', () => {
  const cases: ReadonlyArray<[string, Partial<ChallengeDraft>, PolicyCode]> = [
    ['Selbstverletzung', { description: 'Du sollst dich selbstverletzen.' }, PolicyCode.SELF_HARM],
    ['Waffen', { description: 'Zeig deine Schusswaffe.' }, PolicyCode.WEAPONS_EXPLOSIVES_CHEMICALS],
    ['Sprengstoff', { description: 'Baue eine Bombe.' }, PolicyCode.WEAPONS_EXPLOSIVES_CHEMICALS],
    ['Diebstahl', { description: 'Klaue etwas im Supermarkt.' }, PolicyCode.ILLEGAL_ACT],
    ['Hausfriedensbruch', { description: 'Brich in ein leeres Haus ein.' }, PolicyCode.TRESPASSING_OR_PROPERTY_DAMAGE],
    ['Sexuelle Inhalte', { description: 'Tanze nackt vor der Kamera.' }, PolicyCode.SEXUAL_CONTENT],
    ['Minderjährige', { description: 'Dein minderjähriger Bruder macht mit.' }, PolicyCode.MINORS_INVOLVED],
    ['Drogen', { description: 'Konsumiere Drogen im Video.' }, PolicyCode.DRUG_USE],
    ['Gefährlicher Ort', { description: 'Lauf über die Gleise.' }, PolicyCode.DANGEROUS_LOCATION],
    ['Erniedrigung', { description: 'Blamiere deinen Kollegen vor allen.' }, PolicyCode.HUMILIATION_BULLYING_COERCION],
    ['Heimliche Aufnahme', { description: 'Film sie mit versteckter Kamera.' }, PolicyCode.COVERT_RECORDING],
    ['Datenpreisgabe', { description: 'Zeig deinen Personalausweis in die Kamera.' }, PolicyCode.PRIVATE_DATA_EXPOSURE],
    ['Gefälschter Beweis', { description: 'Nutze ein gefälschtes Video als Beweis.' }, PolicyCode.FRAUD_OR_FAKE_EVIDENCE],
    ['Medizinisches Experiment', { description: 'Nimm ein Medikament und filme die Wirkung.' }, PolicyCode.MEDICAL_SELF_EXPERIMENT],
    ['Glücksspiel', { description: 'Wette auf den Ausgang und verdopple deinen Gewinn.' }, PolicyCode.GAMBLING_OR_BETTING],
  ];

  for (const [name, over, expectedCode] of cases) {
    it(`lehnt „${name}" ab`, () => {
      const r = evaluateChallengePolicy(draft(over));
      expect(r.prohibited, name).toBe(true);
      expect(r.riskLevel).toBe(RiskLevel.PROHIBITED);
      expect(r.policyCodes).toContain(expectedCode);
      expect(r.requiresManualReview).toBe(true);
      expect(r.messages.length).toBeGreaterThan(0);
    });
  }

  it('prüft auch die Erfolgskriterien, nicht nur Titel und Beschreibung', () => {
    const r = evaluateChallengePolicy(
      draft({ criteria: ['Der Beweiscode muss genannt werden', 'Klaue dabei ein Schild'] }),
    );
    expect(r.prohibited).toBe(true);
    expect(r.policyCodes).toContain(PolicyCode.ILLEGAL_ACT);
  });

  it('sammelt mehrere Verstöße gleichzeitig', () => {
    const r = evaluateChallengePolicy(
      draft({ description: 'Nimm Drogen und lauf über die Gleise.' }),
    );
    expect(r.policyCodes).toContain(PolicyCode.DRUG_USE);
    expect(r.policyCodes).toContain(PolicyCode.DANGEROUS_LOCATION);
  });
});

describe('Policy Engine: Hochrisiko und Eskalation', () => {
  it('stuft das Döner-Wettessen aus der Spezifikation als hochriskant ein', () => {
    // §35.2: „Wer einen Döner am schnellsten isst" darf nicht einfach durchgehen.
    const r = evaluateChallengePolicy(
      draft({
        title: 'Döner-Challenge',
        description: 'Wer einen Döner am schnellsten isst, gewinnt.',
        category: Category.FOOD,
      }),
    );
    expect(r.riskLevel).toBe(RiskLevel.HIGH);
    expect(r.policyCodes).toContain(PolicyCode.EXTREME_EATING_OR_CHOKING);
    expect(r.requiresManualReview).toBe(true);
  });

  it('lässt die sichere Umformulierung derselben Idee zu', () => {
    // Sichere Alternative aus §35.2 — Kategorie FOOD bleibt aber prüfpflichtig.
    const r = evaluateChallengePolicy(
      draft({
        title: 'Döner-Präsentation',
        description: 'Zeige die kreativste, hygienische Präsentation in maximal 60 Sekunden.',
        category: Category.FOOD,
      }),
    );
    expect(r.prohibited).toBe(false);
    expect(r.riskLevel).toBe(RiskLevel.MEDIUM);
  });

  it('eskaliert Dritte ohne bestätigte Zustimmung', () => {
    const r = evaluateChallengePolicy(
      draft({ thirdPartiesMayAppear: true, thirdPartyConsentConfirmed: false }),
    );
    expect(r.riskLevel).toBe(RiskLevel.HIGH);
    expect(r.policyCodes).toContain(PolicyCode.NON_CONSENTING_THIRD_PARTY);
  });

  it('akzeptiert Dritte mit bestätigter Zustimmung', () => {
    const r = evaluateChallengePolicy(
      draft({ thirdPartiesMayAppear: true, thirdPartyConsentConfirmed: true }),
    );
    expect(r.policyCodes).not.toContain(PolicyCode.NON_CONSENTING_THIRD_PARTY);
  });
});

describe('Policy Engine: Kategorien mit Pflichtprüfung (§14.2, §14.3)', () => {
  it('schickt Beziehungs-Challenges immer in die manuelle Prüfung', () => {
    const r = evaluateChallengePolicy(draft({ category: Category.RELATIONSHIPS_SOCIAL }));
    expect(r.riskLevel).toBe(RiskLevel.MEDIUM);
    expect(r.requiresManualReview).toBe(true);
  });

  it('schickt Wissenschafts-Challenges immer in die manuelle Prüfung', () => {
    const r = evaluateChallengePolicy(draft({ category: Category.KNOWLEDGE_SCIENCE }));
    expect(r.requiresManualReview).toBe(true);
  });

  it('prüft „Sonstiges" immer manuell', () => {
    const r = evaluateChallengePolicy(draft({ category: Category.OTHER }));
    expect(r.requiresManualReview).toBe(true);
  });

  it('lässt ein Verbot schwerer wiegen als die Kategorie', () => {
    const r = evaluateChallengePolicy(
      draft({ category: Category.RELATIONSHIPS_SOCIAL, description: 'Erpresse deinen Ex-Partner.' }),
    );
    expect(r.riskLevel).toBe(RiskLevel.PROHIBITED);
  });
});

describe('Policy Engine: Ausgabeform', () => {
  it('liefert ein zur Entscheidungsmatrix passendes Verdict', () => {
    const r = evaluateChallengePolicy(draft({ description: 'Baue eine Bombe.' }));
    // Genau die Felder, die @vcp/ai-governance als PolicyVerdict erwartet.
    expect(r).toHaveProperty('prohibited');
    expect(r).toHaveProperty('policyCodes');
    expect(Array.isArray(r.policyCodes)).toBe(true);
  });

  it('gibt für jeden Fund eine deutsche Begründung aus', () => {
    const r = evaluateChallengePolicy(draft({ description: 'Konsumiere Drogen.' }));
    expect(r.messages[0]).toMatch(/Drogenkonsum/);
  });
});
