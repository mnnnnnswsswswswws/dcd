export { joinChallenge } from './challenges/join-challenge.js';
export type {
  JoinChallengeDeps,
  JoinChallengeInput,
  JoinChallengeResult,
} from './challenges/join-challenge.js';
export { handleJoinChallenge } from './challenges/join-challenge.handler.js';
export type { JoinChallengeHttpResponse } from './challenges/join-challenge.handler.js';
export { createChallenge } from './challenges/create-challenge.js';
export type {
  CreateChallengeDeps,
  CreateChallengeInput,
  CreateChallengeResult,
} from './challenges/create-challenge.js';
export { confirmFunding } from './funding/confirm-funding.js';
export type {
  ConfirmFundingDeps,
  ConfirmFundingInput,
  ConfirmFundingResult,
} from './funding/confirm-funding.js';
export { submitEntry } from './submissions/submit-entry.js';
export { createEvidenceIntent } from './submissions/create-evidence-intent.js';
export type { CreateEvidenceIntentResult } from './submissions/create-evidence-intent.js';
export { MockEvidenceStorageProvider } from './storage/mock-storage-provider.js';
export { S3EvidenceStorageProvider } from './storage/s3-storage-provider.js';
export { presignS3PutUrl, encodeS3Key, encodeRfc3986 } from './storage/s3-presign.js';
export type { EvidenceStorageProvider } from './storage/storage-provider.js';
export { moderateSubmission } from './submissions/moderate-submission.js';
export { castVote } from './submissions/cast-vote.js';
export { closeSubmissions } from './challenges/close-submissions.js';
export { selectWinner } from './challenges/select-winner.js';
export type { SelectWinnerResult } from './challenges/select-winner.js';
export { processPayout } from './funding/process-payout.js';
export type { ProcessPayoutResult } from './funding/process-payout.js';
export { cancelChallenge } from './challenges/cancel-challenge.js';
export type { CancelChallengeResult } from './challenges/cancel-challenge.js';
export { registerUser } from './users/register-user.js';
export type { RegisterUserResult } from './users/register-user.js';
export { updateProfile } from './users/update-profile.js';
export type { ProfileResult } from './users/update-profile.js';
export { getProfileByUsername } from './users/get-profile.js';
export type { PublicProfile } from './users/get-profile.js';
export { MockAppCheckVerifier } from './app-check/app-check-verifier.js';
export type { AppCheckVerifier } from './app-check/app-check-verifier.js';
export { createAppCheckVerifier } from './app-check/create-app-check-verifier.js';
export { toggleLike, toggleBookmark, addComment, listComments, listMyLikeIds, listMyBookmarkIds, countsFor } from './social/social.js';
export type { CommentRow } from './social/social.js';
export { writeNotification } from './notifications/write-notification.js';
export { listNotifications, markAllNotificationsRead } from './notifications/list-notifications.js';
export type { NotificationRow, ListNotificationsResult } from './notifications/list-notifications.js';
export { createReport } from './reports/create-report.js';
export type { CreateReportResult } from './reports/create-report.js';
export { updateReport } from './reports/update-report.js';
export type { UpdateReportResult } from './reports/update-report.js';
export { expireSlots } from './workers/expire-slots.js';
export type { ExpireSlotsDeps, ExpireSlotsResult } from './workers/expire-slots.js';
export { closeExpiredSubmissions } from './workers/close-expired-submissions.js';
export type {
  CloseExpiredSubmissionsDeps,
  CloseExpiredSubmissionsResult,
} from './workers/close-expired-submissions.js';
export {
  LoggingEventPublisher,
  InMemoryEventPublisher,
} from './events/event-publisher.js';
export type { DomainEvent, EventPublisher } from './events/event-publisher.js';

/* Scale S1 — asynchrone Operationen, Projektion und Detail-Cache. */
export {
  OperationKind,
  TransitionOutcome,
  createOperation,
  getOperation,
  isTerminal,
  markFailed,
  markRunning,
  markSucceeded,
  purgeExpiredOperations,
} from './operations/async-operations.js';
export type { OperationView } from './operations/async-operations.js';
export {
  ProjectionOutcome,
  applyChallengeProjection,
  rebuildChallengeProjection,
} from './projections/challenge-projection.js';
export { ChallengeDetailCache } from './challenges/challenge-detail-cache.js';
export type { PublicChallengeView } from './challenges/challenge-detail-cache.js';
export { writeOutboxEvent, writeOutboxEvents, Aggregate } from './events/outbox.js';
export {
  buildDatasourceUrl,
  resolvePoolSize,
  withPoolSettings,
  FALLBACK_POOL_SIZE,
  createPooledPrismaClient,
} from './prisma/pool-url.js';

/* Scale S1 — Dashboard-Datenquelle (Aufgabe 15). */
export {
  STUCK_OPERATION_MS,
  collectBusinessIntegrity,
  collectDbMetrics,
  collectMetrics,
  collectOutboxMetrics,
  collectProjectionMetrics,
  collectQueueMetrics,
  collectReplicaMetrics,
} from './observability/metrics.js';
export type { MetricsSnapshot, BusinessIntegritySnapshot } from './observability/metrics.js';
export { consumeFromOutbox, PROJECTION_NAME, DEFAULT_CONSUME_BATCH } from './projections/consume-outbox.js';
export type { ConsumeStats } from './projections/consume-outbox.js';
