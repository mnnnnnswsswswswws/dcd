/**
 * @vcp/outbox — Transactional Outbox, Publisher und Consumer-Inbox (Scale S1).
 *
 * Garantiemodell, ehrlich benannt:
 *   • Event und Zustandsänderung liegen im selben Commit (Regel 4).
 *   • Zustellung ist **at-least-once**, nicht exactly-once.
 *   • Effektiv einmalige Wirkung entsteht erst durch die idempotenten Consumer.
 */

export * from './types.js';
export * from './publisher.js';
export * from './inbox.js';
export * from './prisma-store.js';
export * from './publishers.js';
