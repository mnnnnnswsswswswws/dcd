/**
 * Deterministische Policy Engine (§35.3, §14).
 *
 * Diese Engine läuft **vor** jeder Modellentscheidung und ist autoritativ: Ein
 * generatives Modell darf ihr Ergebnis nicht überschreiben.
 *
 * Ehrliche Einordnung der Grenzen — bewusst dokumentiert statt überverkauft:
 * Musterabgleich erkennt das Offensichtliche, nicht das Umschriebene. Er ist eine
 * **Untergrenze**, keine vollständige Erkennung. Deshalb gilt hier durchgängig:
 *   • Ein Treffer kann sperren oder eskalieren — er kann nie „freigeben".
 *   • Kein Treffer bedeutet ausdrücklich nicht „sicher", sondern nur „kein
 *     deterministischer Verstoß". Die Freigabe entscheidet erst die Gesamtmatrix
 *     aus Regeln, Modellen und — bei jedem Zweifel — einem Menschen.
 */

import {
  CATEGORIES_REQUIRING_MANUAL_REVIEW,
  POLICY_MESSAGES,
  PolicyCode,
  type Category,
} from './policy-codes.js';

export const RiskLevel = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  PROHIBITED: 'PROHIBITED',
} as const;
export type RiskLevel = (typeof RiskLevel)[keyof typeof RiskLevel];

interface Rule {
  readonly code: PolicyCode;
  /** PROHIBITED = harte Ablehnung; HIGH = Ablehnung bzw. Eskalation je Kontext. */
  readonly severity: 'PROHIBITED' | 'HIGH';
  readonly patterns: readonly RegExp[];
}

/**
 * Regelwerk in Deutsch und Englisch (Startmarkt Deutschland, Inhalte oft gemischt).
 * Die Muster zielen auf die *Aufforderung*, nicht auf bloße Erwähnung — perfekt ist
 * das nicht, deshalb eskaliert die Engine im Zweifel statt zu blockieren.
 */
const RULES: readonly Rule[] = [
  {
    code: PolicyCode.SELF_HARM,
    severity: 'PROHIBITED',
    patterns: [/\bselbstverletz/i, /\britz(en|e)\b/i, /\bsuizid/i, /\bselbstmord/i, /\bself[- ]?harm/i],
  },
  {
    code: PolicyCode.WEAPONS_EXPLOSIVES_CHEMICALS,
    severity: 'PROHIBITED',
    patterns: [
      /\bwaffe(n)?\b/i,
      /\bschusswaffe/i,
      /\bsprengstoff/i,
      /\bbombe(n)?\b/i,
      /\bexplosiv/i,
      /\bmolotow/i,
      /\bexplosive[s]?\b/i,
    ],
  },
  {
    code: PolicyCode.VIOLENCE_AGAINST_PEOPLE_OR_ANIMALS,
    severity: 'PROHIBITED',
    patterns: [
      /\bschlag(e|en)\s+(jemand|eine[nr]?|dein)/i,
      /\bprügel/i,
      /\bverprügel/i,
      /\btier(e|en)?\s+quäl/i,
      /\bgewalt\s+gegen/i,
    ],
  },
  {
    code: PolicyCode.DANGEROUS_DRIVING,
    severity: 'PROHIBITED',
    patterns: [
      /\braser(ei|n)\b/i,
      /\billegale[sn]?\s+(auto)?rennen/i,
      /\bgeisterfahr/i,
      /\bautobahn\s+(zu\s+fuß|überquer)/i,
      /\bdriften\s+im\s+verkehr/i,
    ],
  },
  {
    code: PolicyCode.TRESPASSING_OR_PROPERTY_DAMAGE,
    severity: 'PROHIBITED',
    patterns: [
      /\bhausfriedensbruch/i,
      /\beinbrech(en|e|t)?\b/i,
      /\beinbruch\b/i,
      // Trennbares Verb: „brich in … ein", „bricht … ein".
      /\bbrich(st|t)?\b[^.!?]{0,40}\bein\b/i,
      /\bsachbeschädigung/i,
      /\bgraffiti\s+auf\s+fremd/i,
      /\btrespass/i,
    ],
  },
  {
    code: PolicyCode.SEXUAL_CONTENT,
    severity: 'PROHIBITED',
    patterns: [/\bnackt/i, /\bnacktheit/i, /\bsexuelle[rns]?\b/i, /\bstriptease/i, /\bporno/i],
  },
  {
    code: PolicyCode.MINORS_INVOLVED,
    severity: 'PROHIBITED',
    patterns: [
      /\bminderjährig/i,
      /\bunter\s?18\b/i,
      /\bkind(er)?\s+(müssen|sollen|zeigen|filmen)/i,
      /\bschüler(in)?\s+(muss|soll)/i,
    ],
  },
  {
    code: PolicyCode.DRUG_USE,
    severity: 'PROHIBITED',
    patterns: [/\bdrogen/i, /\bkokain/i, /\bheroin/i, /\bkiff(en|e)\b/i, /\blachgas/i],
  },
  {
    code: PolicyCode.UNKNOWN_SUBSTANCE_INGESTION,
    severity: 'PROHIBITED',
    patterns: [
      /\bunbekannte[ns]?\s+(stoff|substanz|flüssigkeit)/i,
      /\btrink(e|en)\s+(etwas\s+)?unbekannt/i,
      /\biss\s+etwas\s+unbekannt/i,
    ],
  },
  {
    code: PolicyCode.EXTREME_EATING_OR_CHOKING,
    severity: 'HIGH',
    patterns: [
      /\bso\s+schnell\s+wie\s+möglich\s+(ess|iss|trink)/i,
      /\bwettessen/i,
      /\bwetttrinken/i,
      /\bam\s+schnellsten\s+(isst|trinkt)/i,
      /\bin\s+einem\s+zug\s+austrinken/i,
      /\bmöglichst\s+viele?\s+\w+\s+(essen|iss)/i,
    ],
  },
  {
    code: PolicyCode.MEDICAL_SELF_EXPERIMENT,
    severity: 'PROHIBITED',
    // Auch hier beide Wortstellungen („nimm ein Medikament" / „Medikament nehmen").
    patterns: [
      /\b(medikament|tablette|pille)\w*\b[^.!?]{0,30}\b(nehm|nimm|schluck|test|einnehm)/i,
      /\b(nehm|nimm|schluck|test|einnehm)\w*\b[^.!?]{0,30}\b(medikament|tablette|pille)/i,
      /\bselbstexperiment/i,
      /\bspritz(e|en)\s+dir/i,
    ],
  },
  {
    code: PolicyCode.HUMILIATION_BULLYING_COERCION,
    severity: 'PROHIBITED',
    patterns: [
      /\bblamier(e|en)\b/i,
      /\bbloßstell(en|e)\b/i,
      /\bdemütig(e|en|ung)/i,
      /\bmobb(ing|e|en)\b/i,
      // Alle Beugungen: erpresse/erpresst/erpressen/Erpressung.
      /\berpress(e|st|t|en|ung)?\b/i,
      /\blächerlich\s+mach/i,
    ],
  },
  {
    code: PolicyCode.COVERT_RECORDING,
    severity: 'PROHIBITED',
    patterns: [
      /\bheimlich\s+(film|aufnehm|aufzeichn)/i,
      /\bohne\s+(dass|deren)\s+\w*\s*(es\s+)?merk/i,
      /\bversteckte[rn]?\s+kamera/i,
    ],
  },
  {
    code: PolicyCode.STALKING_OR_HARASSMENT,
    severity: 'PROHIBITED',
    patterns: [/\bverfolg(e|en)\s+(jemand|eine)/i, /\bstalk(ing|en)?\b/i, /\bbelästig/i],
  },
  {
    code: PolicyCode.PRIVATE_DATA_EXPOSURE,
    severity: 'PROHIBITED',
    // Beide Wortstellungen: „Adresse zeigen" und „zeig deine Adresse".
    patterns: [
      /\b(adresse|telefonnummer|personalausweis|ausweis)\b[^.!?]{0,30}\b(zeig|nenn|post|filme|verrat)/i,
      /\b(zeig|nenn|post|filme|verrat)\w*\b[^.!?]{0,30}\b(adresse|telefonnummer|personalausweis|ausweis)\b/i,
      /\bdoxx/i,
    ],
  },
  {
    code: PolicyCode.FRAUD_OR_FAKE_EVIDENCE,
    severity: 'PROHIBITED',
    patterns: [
      /\bfälsch(e|en)\b/i,
      /\bgefälschte[sn]?\s+(beweis|video)/i,
      /\bbetrüg(en|e)\b/i,
      /\bidentität\s+(stehlen|vortäuschen)/i,
    ],
  },
  {
    code: PolicyCode.DANGEROUS_LOCATION,
    severity: 'PROHIBITED',
    patterns: [
      /\bgleis(e|en)?\b/i,
      /\bbahnanlage/i,
      /\bhochhaus\s*dach/i,
      /\bdach\s+kante/i,
      /\bbrückengeländer/i,
      /\bautobahn\b/i,
      /\bgesperrte[rn]?\s+(ort|gebiet|gelände)/i,
      /\brooftop/i,
    ],
  },
  {
    code: PolicyCode.ILLEGAL_ACT,
    severity: 'PROHIBITED',
    patterns: [/\bstehl(en|e)\b/i, /\bklau(en|e)\b/i, /\bladendiebstahl/i, /\billegal(e|es|en)?\b/i],
  },
  {
    code: PolicyCode.GAMBLING_OR_BETTING,
    severity: 'PROHIBITED',
    patterns: [
      /\bwette\s+(auf|gegen)/i,
      /\beinsatz\s+zahlen/i,
      /\bglücksspiel/i,
      /\bjackpot/i,
      /\blootbox/i,
      /\bverdopple\s+deinen\s+gewinn/i,
    ],
  },
];

export interface ChallengeDraft {
  readonly title: string;
  readonly description: string;
  readonly category: Category;
  /** Einzelne Erfolgskriterien; werden mitgeprüft. */
  readonly criteria?: readonly string[];
  /** Dürfen andere Personen im Video vorkommen? */
  readonly thirdPartiesMayAppear?: boolean;
  /** Liegt die Zustimmung aller sichtbaren Beteiligten vor? */
  readonly thirdPartyConsentConfirmed?: boolean;
}

export interface PolicyFinding {
  readonly code: PolicyCode;
  readonly severity: 'PROHIBITED' | 'HIGH';
  readonly message: string;
}

export interface PolicyEvaluation {
  readonly riskLevel: RiskLevel;
  /** Kompatibel zum `PolicyVerdict` der Entscheidungsmatrix in @vcp/ai-governance. */
  readonly prohibited: boolean;
  readonly policyCodes: readonly PolicyCode[];
  readonly findings: readonly PolicyFinding[];
  readonly requiresManualReview: boolean;
  /** Nutzersichtbare deutsche Begründungen. */
  readonly messages: readonly string[];
}

function haystack(draft: ChallengeDraft): string {
  return [draft.title, draft.description, ...(draft.criteria ?? [])].join('\n');
}

/**
 * Wertet einen Challenge-Entwurf deterministisch aus.
 *
 * Ergebnislogik (§14.4):
 *   • PROHIBITED → automatische Ablehnung, kein Payment-Capture
 *   • HIGH       → Ablehnung bzw. zwingende manuelle Prüfung
 *   • MEDIUM     → manuelle Prüfung vor Veröffentlichung
 *   • LOW        → darf die automatische Vorprüfung passieren (Freigabe entscheidet
 *                  aber weiterhin die Gesamtmatrix, nicht diese Funktion allein)
 */
export function evaluateChallengePolicy(draft: ChallengeDraft): PolicyEvaluation {
  const text = haystack(draft);
  const findings: PolicyFinding[] = [];

  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(text))) {
      findings.push({
        code: rule.code,
        severity: rule.severity,
        message: POLICY_MESSAGES[rule.code],
      });
    }
  }

  // Dritte ohne bestätigte Zustimmung sind ein eigener, struktureller Verstoß (§14.2).
  if (draft.thirdPartiesMayAppear === true && draft.thirdPartyConsentConfirmed !== true) {
    findings.push({
      code: PolicyCode.NON_CONSENTING_THIRD_PARTY,
      severity: 'HIGH',
      message: POLICY_MESSAGES[PolicyCode.NON_CONSENTING_THIRD_PARTY],
    });
  }

  const hasProhibited = findings.some((f) => f.severity === 'PROHIBITED');
  const hasHigh = findings.some((f) => f.severity === 'HIGH');
  const categoryNeedsReview = CATEGORIES_REQUIRING_MANUAL_REVIEW.includes(draft.category);

  let riskLevel: RiskLevel = RiskLevel.LOW;
  if (hasProhibited) riskLevel = RiskLevel.PROHIBITED;
  else if (hasHigh) riskLevel = RiskLevel.HIGH;
  else if (categoryNeedsReview) riskLevel = RiskLevel.MEDIUM;

  return {
    riskLevel,
    prohibited: hasProhibited,
    policyCodes: findings.map((f) => f.code),
    findings,
    // Alles außer sauberem LOW geht durch Menschenhand.
    requiresManualReview: riskLevel !== RiskLevel.LOW,
    messages: findings.map((f) => f.message),
  };
}
