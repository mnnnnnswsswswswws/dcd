/**
 * Versionierte, sichtbarkeitsbewusste Cache-Schlüssel (Scale S1, Regel 10).
 *
 * Zwei Eigenschaften, die hier strukturell erzwungen werden statt per Disziplin:
 *
 *   1. **Versionierung.** Invalidiert wird durch Hochzählen der Namespace-Version,
 *      nicht durch Löschen einzelner Schlüssel. Ein Bump macht sämtliche alten
 *      Schlüssel unerreichbar — atomar, ohne Scan, ohne Lücke.
 *
 *   2. **Keine Vermischung von privat und öffentlich.** Ein privater Schlüssel ohne
 *      Subjekt ist ein Typ- **und** Laufzeitfehler. Damit kann eine personalisierte
 *      Antwort nicht versehentlich unter einem geteilten Schlüssel landen.
 */

export const Visibility = {
  /** Für alle identisch — darf über Nutzer hinweg geteilt und im CDN liegen. */
  PUBLIC: 'PUBLIC',
  /** Nutzer- oder rollenspezifisch — niemals geteilt, niemals im CDN. */
  PRIVATE: 'PRIVATE',
} as const;
export type Visibility = (typeof Visibility)[keyof typeof Visibility];

export class PrivateKeyWithoutSubjectError extends Error {
  constructor(namespace: string) {
    super(
      `Privater Cache-Schlüssel im Namespace "${namespace}" ohne subjectId — private Antworten dürfen nicht geteilt werden.`,
    );
    this.name = 'PrivateKeyWithoutSubjectError';
  }
}

export interface KeySpec {
  readonly namespace: string;
  /** Aus `cache_namespaces`; ein Bump invalidiert alles darunter. */
  readonly version: number;
  /** Fachlicher Bezeichner, z. B. eine Challenge-ID. */
  readonly id: string;
  readonly visibility: Visibility;
  /** Pflicht bei PRIVATE: Nutzer-ID o. Ä. */
  readonly subjectId?: string;
  /** Optionale Varianten (Sprache, Seitengröße …). */
  readonly variant?: Readonly<Record<string, string | number | boolean>>;
}

function serializeVariant(variant: KeySpec['variant']): string {
  if (!variant) return '';
  const parts = Object.keys(variant)
    .sort()
    .map((k) => `${k}=${String(variant[k])}`);
  return parts.length > 0 ? `|${parts.join('&')}` : '';
}

/**
 * Baut den Schlüssel. Schema:
 *   `<namespace>:v<version>:pub:<id>[|variant]`
 *   `<namespace>:v<version>:usr:<subjectId>:<id>[|variant]`
 */
export function buildKey(spec: KeySpec): string {
  if (spec.visibility === Visibility.PRIVATE && !spec.subjectId) {
    throw new PrivateKeyWithoutSubjectError(spec.namespace);
  }
  const scope =
    spec.visibility === Visibility.PUBLIC ? 'pub' : `usr:${spec.subjectId as string}`;
  return `${spec.namespace}:v${spec.version}:${scope}:${spec.id}${serializeVariant(spec.variant)}`;
}

/** Darf diese Antwort in ein geteiltes Medium (CDN, Shared Redis-Eintrag)? */
export function isShareable(spec: Pick<KeySpec, 'visibility'>): boolean {
  return spec.visibility === Visibility.PUBLIC;
}

/**
 * Namespace-Versionen. Quelle der Wahrheit ist `cache_namespaces` in PostgreSQL;
 * diese Klasse hält sie im Prozess vor und erlaubt einen expliziten Bump.
 */
export class NamespaceVersions {
  private readonly versions = new Map<string, number>();

  constructor(initial: Readonly<Record<string, number>> = {}) {
    for (const [ns, v] of Object.entries(initial)) this.versions.set(ns, v);
  }

  get(namespace: string): number {
    return this.versions.get(namespace) ?? 1;
  }

  /** Invalidiert alles unter diesem Namespace, ohne einen einzigen Key zu löschen. */
  bump(namespace: string): number {
    const next = this.get(namespace) + 1;
    this.versions.set(namespace, next);
    return next;
  }

  set(namespace: string, version: number): void {
    this.versions.set(namespace, version);
  }
}
