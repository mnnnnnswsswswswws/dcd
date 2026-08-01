/**
 * Policy-Codes und Kategorien (§14.1–§14.4).
 *
 * Die Codes sind stabil und maschinenlesbar: Sie erscheinen in Reason Statements,
 * Audit-Logs, Einsprüchen und Moderationsstatistiken. Nutzersichtbare Texte sind
 * Deutsch, die Codes selbst Englisch (Projektkonvention).
 */

/** Verbotene Handlungen und Inhalte — Mindestliste aus §14.1. */
export const PolicyCode = {
  ILLEGAL_ACT: 'ILLEGAL_ACT',
  SELF_HARM: 'SELF_HARM',
  VIOLENCE_AGAINST_PEOPLE_OR_ANIMALS: 'VIOLENCE_AGAINST_PEOPLE_OR_ANIMALS',
  WEAPONS_EXPLOSIVES_CHEMICALS: 'WEAPONS_EXPLOSIVES_CHEMICALS',
  DANGEROUS_DRIVING: 'DANGEROUS_DRIVING',
  TRESPASSING_OR_PROPERTY_DAMAGE: 'TRESPASSING_OR_PROPERTY_DAMAGE',
  SEXUAL_CONTENT: 'SEXUAL_CONTENT',
  MINORS_INVOLVED: 'MINORS_INVOLVED',
  DRUG_USE: 'DRUG_USE',
  UNKNOWN_SUBSTANCE_INGESTION: 'UNKNOWN_SUBSTANCE_INGESTION',
  EXTREME_EATING_OR_CHOKING: 'EXTREME_EATING_OR_CHOKING',
  MEDICAL_SELF_EXPERIMENT: 'MEDICAL_SELF_EXPERIMENT',
  HUMILIATION_BULLYING_COERCION: 'HUMILIATION_BULLYING_COERCION',
  COVERT_RECORDING: 'COVERT_RECORDING',
  NON_CONSENTING_THIRD_PARTY: 'NON_CONSENTING_THIRD_PARTY',
  STALKING_OR_HARASSMENT: 'STALKING_OR_HARASSMENT',
  PRIVATE_DATA_EXPOSURE: 'PRIVATE_DATA_EXPOSURE',
  FRAUD_OR_FAKE_EVIDENCE: 'FRAUD_OR_FAKE_EVIDENCE',
  DANGEROUS_LOCATION: 'DANGEROUS_LOCATION',
  REWARD_DRIVES_RISKY_BEHAVIOUR: 'REWARD_DRIVES_RISKY_BEHAVIOUR',
  /** Glücksspiel-/Wettcharakter der Aufgabe selbst (§35.2). */
  GAMBLING_OR_BETTING: 'GAMBLING_OR_BETTING',
} as const;
export type PolicyCode = (typeof PolicyCode)[keyof typeof PolicyCode];

/** Nutzersichtbare deutsche Begründungen je Code. */
export const POLICY_MESSAGES: Record<PolicyCode, string> = {
  ILLEGAL_ACT: 'Die Aufgabe fordert eine rechtswidrige Handlung.',
  SELF_HARM: 'Die Aufgabe hat einen Bezug zu Selbstverletzung.',
  VIOLENCE_AGAINST_PEOPLE_OR_ANIMALS: 'Die Aufgabe beinhaltet Gewalt gegen Menschen oder Tiere.',
  WEAPONS_EXPLOSIVES_CHEMICALS: 'Die Aufgabe betrifft Waffen, Sprengstoffe oder gefährliche Chemikalien.',
  DANGEROUS_DRIVING: 'Die Aufgabe fordert gefährliches Fahren oder Eingriffe in den Verkehr.',
  TRESPASSING_OR_PROPERTY_DAMAGE: 'Die Aufgabe fordert Hausfriedensbruch oder Sachbeschädigung.',
  SEXUAL_CONTENT: 'Die Aufgabe beinhaltet sexuelle Handlungen oder Nacktheit.',
  MINORS_INVOLVED: 'Minderjährige dürfen in bezahlten Challenge-Videos nicht mitwirken.',
  DRUG_USE: 'Die Aufgabe beinhaltet Drogenkonsum.',
  UNKNOWN_SUBSTANCE_INGESTION: 'Die Aufgabe fordert das Einnehmen unbekannter Stoffe.',
  EXTREME_EATING_OR_CHOKING: 'Die Aufgabe birgt ein Erstickungs- oder Überessensrisiko.',
  MEDICAL_SELF_EXPERIMENT: 'Die Aufgabe beinhaltet ein medizinisches Selbstexperiment.',
  HUMILIATION_BULLYING_COERCION: 'Die Aufgabe zielt auf Erniedrigung, Mobbing oder Zwang.',
  COVERT_RECORDING: 'Heimliche Aufnahmen sind nicht zulässig.',
  NON_CONSENTING_THIRD_PARTY: 'Die Aufgabe bezieht Dritte ohne deren Zustimmung ein.',
  STALKING_OR_HARASSMENT: 'Die Aufgabe zielt auf Stalking oder Belästigung.',
  PRIVATE_DATA_EXPOSURE: 'Die Aufgabe fordert die Preisgabe privater Daten.',
  FRAUD_OR_FAKE_EVIDENCE: 'Die Aufgabe zielt auf Betrug oder gefälschte Beweise.',
  DANGEROUS_LOCATION: 'Die Aufgabe führt an gefährliche oder gesperrte Orte.',
  REWARD_DRIVES_RISKY_BEHAVIOUR: 'Die Belohnung würde erkennbar riskantes Verhalten antreiben.',
  GAMBLING_OR_BETTING: 'Die Aufgabe hat Glücksspiel- oder Wettcharakter.',
};

/** Kategorien im MVP (§6, Schritt 1). */
export const Category = {
  SPORT_SKILLS: 'SPORT_SKILLS',
  CREATIVITY_ART: 'CREATIVITY_ART',
  COMEDY: 'COMEDY',
  MUSIC_PERFORMANCE: 'MUSIC_PERFORMANCE',
  KNOWLEDGE_SCIENCE: 'KNOWLEDGE_SCIENCE',
  EVERYDAY_LIFESTYLE: 'EVERYDAY_LIFESTYLE',
  FOOD: 'FOOD',
  RELATIONSHIPS_SOCIAL: 'RELATIONSHIPS_SOCIAL',
  OTHER: 'OTHER',
} as const;
export type Category = (typeof Category)[keyof typeof Category];

/**
 * Kategorien, die immer eine manuelle Vorprüfung auslösen:
 *   • RELATIONSHIPS_SOCIAL — Einwilligung Dritter, Bloßstellungsrisiko (§14.2)
 *   • KNOWLEDGE_SCIENCE — nur risikoarme Experimente (§14.3)
 *   • FOOD — nur risikoarme Aufgaben (§6)
 *   • OTHER — laut Spezifikation immer manuelle Vorprüfung
 */
export const CATEGORIES_REQUIRING_MANUAL_REVIEW: readonly Category[] = [
  Category.RELATIONSHIPS_SOCIAL,
  Category.KNOWLEDGE_SCIENCE,
  Category.FOOD,
  Category.OTHER,
];
