/**
 * Transactional Outbox — Verträge (Scale S1).
 *
 * Zweck: Ein Event kann nie ohne die zugehörige Zustandsänderung existieren und
 * umgekehrt, weil beides im **selben** Commit geschrieben wird. Der Preis dafür ist
 * ehrlich benannt: die Zustellung ist **at-least-once**, nicht „exactly once".
 * Doppelte und verspätete Zustellung sind der Normalfall, nicht der Fehlerfall —
 * Consumer müssen deshalb idempotent bleiben (siehe @vcp/outbox `inbox.ts`).
 *
 * Die Ports sind bewusst schmal gehalten, damit die Logik ohne Datenbank testbar ist
 * und Prisma nur an einer Stelle andockt.
 */

export const OutboxStatus = {
  PENDING: 'PENDING',
  PUBLISHING: 'PUBLISHING',
  PUBLISHED: 'PUBLISHED',
  FAILED: 'FAILED',
} as const;
export type OutboxStatus = (typeof OutboxStatus)[keyof typeof OutboxStatus];

/** Was der Aufrufer beim Schreiben angibt. */
export interface OutboxEventInput {
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: Readonly<Record<string, unknown>>;
  /** Optional vorgegebene Event-ID (z. B. für deterministische Tests). */
  readonly eventId?: string;
}

/** Persistierter Zustand eines Outbox-Eintrags. */
export interface OutboxEventRecord extends OutboxEventInput {
  readonly sequence: bigint;
  readonly eventId: string;
  readonly status: OutboxStatus;
  readonly attempts: number;
  readonly availableAt: Date;
  readonly publishedAt?: Date;
  readonly lastError?: string;
  readonly createdAt: Date;
}

/**
 * Minimaler Transaktionsclient. Alles, was die Outbox vom Aufrufer braucht, ist die
 * Fähigkeit, im laufenden Commit einen Datensatz anzulegen.
 */
export interface OutboxWriter {
  insert(event: OutboxEventInput): Promise<OutboxEventRecord>;
}

/** Speicherport für den Publisher. */
export interface OutboxStore {
  /**
   * Beansprucht bis zu `limit` fällige Events **atomar** und exklusiv.
   *
   * Vertrag (jede Implementierung muss ihn einhalten):
   *   • nutzt `FOR UPDATE SKIP LOCKED`, damit mehrere Publisher parallel laufen,
   *     ohne sich zu blockieren oder dasselbe Event doppelt zu greifen;
   *   • setzt den Status auf `PUBLISHING`, **erhöht `attempts` um 1** und schiebt
   *     `availableAt` um ein Sichtbarkeits-Timeout nach hinten;
   *   • die zurückgegebenen Records tragen bereits den erhöhten `attempts`-Wert.
   *
   * Das Sichtbarkeits-Timeout ist der Grund, warum ein abgestürzter Publisher keine
   * Events verwaist zurücklässt: Nach Ablauf wird derselbe Eintrag erneut beansprucht.
   */
  claimBatch(limit: number, now: Date): Promise<OutboxEventRecord[]>;
  markPublished(sequences: readonly bigint[], now: Date): Promise<void>;
  /** Zurück auf PENDING mit Backoff, oder endgültig FAILED. */
  markFailed(sequence: bigint, error: string, retryAt: Date | null, now: Date): Promise<void>;
}

/** Zielsystem (Pub/Sub). Muss die `eventId` als Deduplizierungsschlüssel mitgeben. */
export interface EventPublisher {
  publish(events: readonly OutboxEventRecord[]): Promise<void>;
}

export interface OutboxMetrics {
  onClaimed?(count: number): void;
  onPublished?(count: number): void;
  onFailed?(sequence: bigint, attempts: number, error: string): void;
  onExhausted?(sequence: bigint): void;
}
