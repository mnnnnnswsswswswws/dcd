/**
 * API-Client der Mobile-App. Spricht dieselbe Plattform-API wie Web/Admin.
 *
 * Die Basis-URL kommt für den Launch aus `EXPO_PUBLIC_API_BASE` (zur Build-Zeit
 * eingebettet); auf dem Gerät kann sie zum Testen überschrieben werden. Das Token
 * (im Mock-Auth-Setup die User-ID) hält der SessionProvider und setzt es hier über
 * `setAuthToken`.
 */
const ENV_BASE =
  process.env.EXPO_PUBLIC_API_BASE && process.env.EXPO_PUBLIC_API_BASE.length > 0
    ? process.env.EXPO_PUBLIC_API_BASE
    : 'http://localhost:8080';

export const API_BASE_IS_FIXED = Boolean(
  process.env.EXPO_PUBLIC_API_BASE && process.env.EXPO_PUBLIC_API_BASE.length > 0,
);

let authToken = '';
let apiBaseOverride: string | null = null;

export function setAuthToken(token: string): void {
  authToken = token;
}

export function setApiBaseOverride(base: string | null): void {
  apiBaseOverride = base && base.length > 0 ? base : null;
}

export function getApiBase(): string {
  return apiBaseOverride ?? ENV_BASE;
}

/** Im Mock-Auth-Setup ist das Token die User-ID; ein Admin-Token ist `admin:<uuid>`. */
export function myUserId(token = authToken): string {
  return token.startsWith('admin:') ? token.slice('admin:'.length) : token;
}

export interface ApiOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
}

export async function api<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.auth !== false && authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }
  const res = await fetch(`${getApiBase()}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  const parsed: unknown = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = (parsed as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(message);
  }
  return parsed as T;
}

/** Registriert einen volljährigen Nutzer; die zurückgegebene ID ist das Token. */
export async function registerUser(): Promise<string> {
  const user = await api<{ id: string }>('/v1/users', { method: 'POST', body: { isAdult: true }, auth: false });
  return user.id;
}

export interface ChallengeSummary {
  id: string;
  title: string;
  category: string | null;
  status: string;
  selectionMode: string;
  prizeAmountCents: number;
  maxSlots: number;
  submissionDeadline: string | null;
  createdAt: string;
  // Optional angereichert von der Liste (Feed/Reveal): reale Live-Daten.
  description?: string | null;
  occupiedSlots?: number;
  likeCount?: number;
  commentCount?: number;
  creator?: { username: string | null; displayName: string | null } | null;
}

export interface Criterion {
  id: string;
  title: string;
  description: string | null;
  mandatory: boolean;
  evidenceType: string | null;
  sortOrder: number;
}

export interface ChallengeDetail extends ChallengeSummary {
  description: string | null;
  creatorId: string;
  occupiedSlots: number;
  criteria: Criterion[];
  winner: { winnerSubmissionId: string | null; decisionSource: string } | null;
}

export interface SubmissionRow {
  id: string;
  participantId: string;
  status: string;
  finalizedAt: string | null;
  createdAt: string;
  voteCount: number;
}

export interface JoinedChallenge extends ChallengeSummary {
  slotStatus: string;
}

export interface MyChallenges {
  created: ChallengeSummary[];
  joined: JoinedChallenge[];
}

export interface PublicConfig {
  longCaptureEnabled: boolean;
  publicFeedEnabled: boolean;
  payoutsEnabled: boolean;
}

export interface EvidenceIntent {
  evidenceRef: string;
  uploadUrl: string;
  expiresAt: string;
}

export interface MyProfile {
  id: string;
  isAdult: boolean;
  username: string | null;
  displayName: string | null;
  bio: string | null;
  createdAt: string;
}

export interface NotificationRow {
  id: string;
  type: string;
  challengeId: string | null;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

export interface NotificationsResult {
  unreadCount: number;
  items: NotificationRow[];
}

export function euro(cents: number): string {
  return `${(cents / 100).toFixed(2).replace('.', ',')} €`;
}

export const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Entwurf',
  PENDING_FUNDING: 'Finanzierung ausstehend',
  OPEN: 'Offen',
  FULL: 'Plätze voll',
  SUBMISSIONS_CLOSED: 'Einsendeschluss',
  IN_REVIEW: 'In Prüfung',
  SELECTION: 'Auswahl läuft',
  WINNER_LOCKED: 'Gewinner steht fest',
  PAID_OUT: 'Ausgezahlt',
  CANCELLED: 'Abgebrochen',
  EXPIRED: 'Abgelaufen',
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export const SELECTION_MODE_LABELS: Record<string, string> = {
  CREATOR_DECIDES: 'Ersteller entscheidet',
  COMMUNITY_VOTE: 'Community-Voting',
};

export function selectionModeLabel(mode: string): string {
  return SELECTION_MODE_LABELS[mode] ?? mode;
}

export const REPORT_REASONS: { value: string; label: string }[] = [
  { value: 'MINORS', label: 'Minderjährige' },
  { value: 'VIOLENCE', label: 'Gewalt' },
  { value: 'SEXUAL', label: 'Sexueller Inhalt' },
  { value: 'DANGEROUS', label: 'Gefährliche Handlung' },
  { value: 'ILLEGAL', label: 'Illegaler Inhalt' },
  { value: 'HARASSMENT', label: 'Belästigung' },
  { value: 'FRAUD', label: 'Betrug' },
  { value: 'COPYRIGHT', label: 'Urheberrecht' },
  { value: 'PRIVACY', label: 'Privatsphäre' },
  { value: 'SPAM', label: 'Spam' },
  { value: 'OTHER', label: 'Sonstiges' },
];
