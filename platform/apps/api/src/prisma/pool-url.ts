/**
 * Ableitung der Verbindungs-URL aus der Kapazitätskonfiguration (Scale S1,
 * Ergänzung zu Aufgaben 12–13).
 *
 * Ohne diesen Schritt gilt das in `@vcp/capacity` geprüfte Budget nur auf dem
 * Papier: Prisma wählt sonst seinen Default (`CPUs × 2 + 1`), der weder aus der
 * Datenbankkapazität abgeleitet ist noch zu den Terraform-Werten passt. Eine
 * Instanz könnte dann mehr Verbindungen öffnen, als das Budget vorsieht — genau
 * der Fehler, den Architekturregel 9 verhindern soll.
 *
 * Die Funktion ist bewusst rein: kein Prisma, kein Netzwerk, damit sie ohne
 * Datenbank testbar bleibt.
 */

/** Wie lange auf eine freie Verbindung aus dem Pool gewartet wird (Sekunden). */
export const DEFAULT_POOL_TIMEOUT_S = 10;

export interface PoolSettings {
  readonly poolSize: number;
  readonly poolTimeoutSeconds?: number;
}

/**
 * Setzt `connection_limit` und `pool_timeout` in der Datenbank-URL.
 *
 * Bestehende Werte werden **überschrieben**, nicht ergänzt: Die Kapazitätsableitung
 * ist die Quelle der Wahrheit, nicht eine zufällig mitgelieferte URL. Alle übrigen
 * Parameter (`sslmode`, `pgbouncer`, `schema` …) bleiben unangetastet.
 */
export function withPoolSettings(databaseUrl: string, settings: PoolSettings): string {
  if (settings.poolSize <= 0) {
    throw new Error('poolSize muss positiv sein.');
  }
  const url = new URL(databaseUrl);
  url.searchParams.set('connection_limit', String(settings.poolSize));
  url.searchParams.set(
    'pool_timeout',
    String(settings.poolTimeoutSeconds ?? DEFAULT_POOL_TIMEOUT_S),
  );
  return url.toString();
}

/**
 * Liest die Poolgröße aus der Umgebung. Terraform setzt `DB_POOL_SIZE` aus
 * derselben Konfiguration, gegen die der CI-Test prüft.
 *
 * Fehlt die Variable, wird bewusst **nicht** geraten, sondern der konservative
 * Default aus der Kapazitätsplanung verwendet — lieber ein Dienst, der kurz auf
 * eine Verbindung wartet, als eine Datenbank, die Verbindungen ablehnt.
 */
export const FALLBACK_POOL_SIZE = 5;

export function resolvePoolSize(
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  const raw = env.DB_POOL_SIZE;
  if (raw === undefined || raw === '') return FALLBACK_POOL_SIZE;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return FALLBACK_POOL_SIZE;
  return parsed;
}

/** Baut die effektive Datasource-URL für diesen Prozess. */
export function buildDatasourceUrl(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const base = env.DATABASE_URL;
  if (base === undefined || base === '') return undefined;
  return withPoolSettings(base, { poolSize: resolvePoolSize(env) });
}

/**
 * Erzeugt einen PrismaClient mit abgeleiteter Poolgröße.
 *
 * Bewusst hier und nicht an jeder Aufrufstelle: Sonst nutzt der eine Prozess die
 * abgeleitete Größe und der nächste Prismas Default — und das Verbindungsbudget
 * stimmt nur noch für einen Teil der Dienste.
 */
export function createPooledPrismaClient<T extends new (options?: never) => unknown>(
  Ctor: T,
  env: Readonly<Record<string, string | undefined>> = process.env,
): InstanceType<T> {
  const url = buildDatasourceUrl(env);
  const C = Ctor as unknown as new (options?: { datasources: { db: { url: string } } }) => InstanceType<T>;
  return url !== undefined ? new C({ datasources: { db: { url } } }) : new C();
}
