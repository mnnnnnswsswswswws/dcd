/**
 * Anti-Glücksspiel-Invarianten (§34.1, Produktregeln 19–23, §39).
 *
 * Das Produkt muss strukturell außerhalb eines unerlaubten öffentlichen Glücksspiels
 * bleiben (GlüStV, § 284 StGB). Die drei tragenden Eigenschaften:
 *
 *   1. Der Teilnehmer zahlt **kein Entgelt** für die Gewinnchance.
 *   2. Der Gewinner wird **nicht durch Zufall** bestimmt.
 *   3. Gewinne können **nicht erneut eingesetzt** werden.
 *
 * Diese Datei implementiert diese Eigenschaften als harte, nicht abschaltbare
 * Prüfungen. Es gibt bewusst **keinen** Override-Parameter und kein Flag, das eine
 * Verletzung zulässt: Ein Coding-Agent oder eine spätere Konfiguration darf diese
 * Invarianten nicht „für eine Demo" aufweichen (§43, Architekturregel).
 */

/**
 * Flags, die in Produktion niemals `true` sein dürfen. Sie existieren nur, damit ein
 * versehentliches Aktivieren laut und früh scheitert — nicht als Schalter.
 */
export const FORBIDDEN_PRODUCTION_FLAGS = [
  'PARTICIPANT_ENTRY_FEES_ENABLED',
  'RANDOM_WINNERS_ENABLED',
  'REWAGERING_ENABLED',
  'LOOTBOXES_ENABLED',
  'MINOR_REAL_MONEY_ACCESS',
] as const;
export type ForbiddenProductionFlag = (typeof FORBIDDEN_PRODUCTION_FLAGS)[number];

export interface InvariantViolation {
  /** Stabiler Code für Logs, Tests und Stop-the-Line-Auswertung. */
  readonly code: string;
  readonly message: string;
}

/** Fehler, der eine verletzte Kern-Invariante signalisiert. Nicht abfangen und ignorieren. */
export class AntiGamblingInvariantError extends Error {
  readonly violations: readonly InvariantViolation[];
  constructor(violations: readonly InvariantViolation[]) {
    super(
      `Anti-Glücksspiel-Invariante verletzt: ${violations.map((v) => v.code).join(', ')}`,
    );
    this.name = 'AntiGamblingInvariantError';
    this.violations = violations;
  }
}

/**
 * Prüft die verbotenen Flags. Ein fehlendes Flag gilt als `false` (sicherer Default);
 * jeder truthy-Wert ist eine Verletzung.
 */
export function checkForbiddenFlags(
  flags: Readonly<Record<string, unknown>>,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  for (const flag of FORBIDDEN_PRODUCTION_FLAGS) {
    if (flags[flag] === true || flags[flag] === 'true') {
      violations.push({
        code: `FORBIDDEN_FLAG_${flag}`,
        message: `Das Flag ${flag} darf in Produktion nicht aktiviert werden.`,
      });
    }
  }
  return violations;
}

/* ------------------------- 1. Kein Teilnehmerentgelt ------------------------- */

/**
 * Zulässige Herkunft von Preisgeld. Teilnehmergelder fehlen hier bewusst: Ein Preis
 * darf niemals aus Einsätzen der Teilnehmer gebildet werden (kein Pooling, §33.2).
 */
export const ALLOWED_PRIZE_FUNDING_SOURCES = [
  'CREATOR_CHARGE',
  'PLATFORM_SPONSORSHIP',
  'BRAND_SPONSORSHIP',
] as const;
export type PrizeFundingSource = (typeof ALLOWED_PRIZE_FUNDING_SOURCES)[number];

/**
 * Prüft, dass ein Preisgeld ausschließlich aus zulässigen Quellen stammt. Jede andere
 * Quelle — insbesondere Teilnehmerzahlungen — ist eine Verletzung.
 */
export function checkPrizeFunding(
  sources: readonly string[],
): InvariantViolation[] {
  const allowed = new Set<string>(ALLOWED_PRIZE_FUNDING_SOURCES);
  const violations: InvariantViolation[] = [];
  for (const source of sources) {
    if (!allowed.has(source)) {
      violations.push({
        code: 'PRIZE_FUNDED_BY_DISALLOWED_SOURCE',
        message: `Preisgeld darf nicht aus der Quelle ${source} stammen; Teilnehmergelder sind ausgeschlossen.`,
      });
    }
  }
  return violations;
}

/**
 * Prüft, dass einem Teilnehmer für Teilnahme, Gewinnchance, zusätzliche Versuche,
 * Stimmen oder Sichtbarkeit während einer laufenden Auswahl kein Betrag berechnet wird.
 */
export function checkParticipantCharge(charge: {
  readonly amountMinor: number;
  readonly purpose: string;
}): InvariantViolation[] {
  if (charge.amountMinor > 0) {
    return [
      {
        code: 'PARTICIPANT_CHARGED',
        message: `Teilnehmer dürfen für "${charge.purpose}" nichts bezahlen — Teilnahme ist entgeltfrei.`,
      },
    ];
  }
  return [];
}

/* ------------------------ 2. Keine Zufallsbestimmung ------------------------ */

/**
 * Zulässige Quellen einer Gewinnerentscheidung. Alle drei sind leistungs- bzw.
 * regelbasiert und vorab veröffentlicht; eine Zufallsquelle existiert nicht.
 */
export const ALLOWED_DECISION_SOURCES = [
  'CREATOR_DECIDES',
  'COMMUNITY_VOTE',
  'AUTO_FALLBACK',
] as const;
export type AllowedDecisionSource = (typeof ALLOWED_DECISION_SOURCES)[number];

/** Prüft, dass eine Gewinnerentscheidung nicht auf Zufall beruht (Regel 21). */
export function checkDecisionSource(source: string): InvariantViolation[] {
  const allowed = new Set<string>(ALLOWED_DECISION_SOURCES);
  if (!allowed.has(source)) {
    return [
      {
        code: 'RANDOM_OR_UNKNOWN_DECISION_SOURCE',
        message: `Gewinner dürfen nicht über "${source}" bestimmt werden; Zufallsziehungen sind verboten.`,
      },
    ];
  }
  return [];
}

/* --------------------------- 3. Kein Rewagering --------------------------- */

/**
 * Prüft, dass ein Gewinn nicht erneut eingesetzt, vervielfacht, in Plattform-Coins
 * getauscht oder gegen andere Nutzer gewettet wird (Regel 20).
 */
export function checkNoRewagering(operation: {
  readonly kind: string;
  readonly sourceIsPrize: boolean;
}): InvariantViolation[] {
  const rewagering = new Set([
    'STAKE',
    'BET',
    'DOUBLE_OR_NOTHING',
    'CONVERT_TO_COINS',
    'BUY_VOTES',
    'BUY_CHANCE',
  ]);
  if (rewagering.has(operation.kind)) {
    return [
      {
        code: 'REWAGERING_ATTEMPTED',
        message: `Die Operation "${operation.kind}" ist unzulässig: Gewinne dürfen nicht erneut eingesetzt werden.`,
      },
    ];
  }
  if (operation.sourceIsPrize && operation.kind === 'FUND_CHALLENGE') {
    return [
      {
        code: 'PRIZE_USED_TO_FUND_CHALLENGE',
        message: 'Ein Gewinn darf nicht unmittelbar als Einsatz für neue Gewinnchancen dienen.',
      },
    ];
  }
  return [];
}

/* ------------------------------ Gesamtprüfung ------------------------------ */

export interface AntiGamblingContext {
  readonly flags?: Readonly<Record<string, unknown>>;
  readonly prizeFundingSources?: readonly string[];
  readonly participantCharge?: { readonly amountMinor: number; readonly purpose: string };
  readonly decisionSource?: string;
  readonly operation?: { readonly kind: string; readonly sourceIsPrize: boolean };
}

/** Sammelt alle Verletzungen, ohne zu werfen — für Reports und Admin-Anzeigen. */
export function checkAntiGamblingInvariants(
  ctx: AntiGamblingContext,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  if (ctx.flags) violations.push(...checkForbiddenFlags(ctx.flags));
  if (ctx.prizeFundingSources) violations.push(...checkPrizeFunding(ctx.prizeFundingSources));
  if (ctx.participantCharge) violations.push(...checkParticipantCharge(ctx.participantCharge));
  if (ctx.decisionSource !== undefined) violations.push(...checkDecisionSource(ctx.decisionSource));
  if (ctx.operation) violations.push(...checkNoRewagering(ctx.operation));
  return violations;
}

/**
 * Harte Variante: wirft bei jeder Verletzung. An allen geldnahen Pfaden aufrufen
 * (Finanzierung, Gewinnerermittlung, Auszahlung, Voting). Bewusst ohne Override.
 */
export function assertAntiGamblingInvariants(ctx: AntiGamblingContext): void {
  const violations = checkAntiGamblingInvariants(ctx);
  if (violations.length > 0) throw new AntiGamblingInvariantError(violations);
}
