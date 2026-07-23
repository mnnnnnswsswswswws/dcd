export interface WebConfig {
  apiBase: string;
  token: string;
}

const API_BASE_KEY = 'vcp.web.apiBase';
const TOKEN_KEY = 'vcp.web.token';

/**
 * Standard-API-Basis: kommt für den Launch aus `NEXT_PUBLIC_API_BASE` (zur Build-Zeit
 * eingebettet). Ohne gesetzte Variable greift der lokale Entwicklungswert. Ein manuell
 * im Browser hinterlegter Wert (localStorage) hat Vorrang und dient nur zum Testen.
 */
const DEFAULT_API_BASE =
  process.env.NEXT_PUBLIC_API_BASE && process.env.NEXT_PUBLIC_API_BASE.length > 0
    ? process.env.NEXT_PUBLIC_API_BASE
    : 'http://localhost:8080';

/** True, wenn die API-Basis fest per Umgebungsvariable vorgegeben ist (Launch-Betrieb). */
export const API_BASE_IS_FIXED = Boolean(
  process.env.NEXT_PUBLIC_API_BASE && process.env.NEXT_PUBLIC_API_BASE.length > 0,
);

export function getConfig(): WebConfig {
  if (typeof window === 'undefined') {
    return { apiBase: DEFAULT_API_BASE, token: '' };
  }
  return {
    apiBase: window.localStorage.getItem(API_BASE_KEY) ?? DEFAULT_API_BASE,
    token: window.localStorage.getItem(TOKEN_KEY) ?? '',
  };
}

export function getToken(): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(TOKEN_KEY) ?? '';
}

/** Im Mock-Auth-Setup ist das Token die User-ID; ein Admin-Token ist `admin:<uuid>`. */
export function myUserId(token = getToken()): string {
  return token.startsWith('admin:') ? token.slice('admin:'.length) : token;
}

export function setApiBase(apiBase: string): void {
  window.localStorage.setItem(API_BASE_KEY, apiBase);
}

export function setToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  window.localStorage.removeItem(TOKEN_KEY);
}

/**
 * Leichte Session-Bus-Abstraktion: die Kopfleiste meldet An-/Abmeldungen, Seiten
 * abonnieren sie, um ohne Prop-Drilling neu zu laden.
 */
const SESSION_EVENT = 'vcp:session';

export function emitSession(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(SESSION_EVENT));
  }
}

export function subscribeSession(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(SESSION_EVENT, cb);
  return () => window.removeEventListener(SESSION_EVENT, cb);
}

export interface ApiOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
}

export async function api<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const { apiBase, token } = getConfig();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.auth !== false && token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${apiBase}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  const parsed: unknown = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = (parsed as { error?: { message?: string } } | null)?.error?.message ?? res.statusText;
    throw new Error(message);
  }
  return parsed as T;
}

/** Registriert einen volljährigen Nutzer und speichert die ID als Token. Optional
 *  wird direkt ein Nutzername gesetzt (für das Onboarding in einem Schritt). */
export async function register(username?: string): Promise<string> {
  const user = await api<{ id: string }>('/v1/users', { method: 'POST', body: { isAdult: true }, auth: false });
  setToken(user.id);
  const name = username?.trim();
  if (name) {
    try {
      await api('/v1/users/me', { method: 'PATCH', body: { username: name } });
    } catch {
      /* Nutzername optional — Registrierung gilt trotzdem. */
    }
  }
  emitSession();
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
  creator?: { username: string | null; displayName: string | null } | null;
  occupiedSlots?: number;
  likeCount?: number;
  commentCount?: number;
}

export interface CommentRow {
  id: string;
  body: string;
  createdAt: string;
  author: string;
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
  likeCount: number;
  commentCount: number;
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

export interface FeedEntry {
  id: string;
  status: string;
  selectionMode: string;
  prizeAmountCents: number;
  decidedAt: string;
  winner: { winnerSubmissionId: string | null; decisionSource: string } | null;
}

export function euro(cents: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cents / 100);
}

export interface PublicConfig {
  longCaptureEnabled: boolean;
  publicFeedEnabled: boolean;
  payoutsEnabled: boolean;
  realMoneyEnabled: boolean;
}

/** Kategorie → Emoji für den immersiven Feed (rein visuell). */
const CATEGORY_EMOJI: { match: RegExp; emoji: string }[] = [
  { match: /sport|skill|freiwurf|basket|fitness/i, emoji: '🏀' },
  { match: /skate|rampe|trick/i, emoji: '🛹' },
  { match: /koch|rezept|food|essen/i, emoji: '🍳' },
  { match: /puzzle|cube|rubik/i, emoji: '🧩' },
  { match: /musik|song|sing|tanz|dance/i, emoji: '🎤' },
  { match: /kunst|art|zeichn|mal/i, emoji: '🎨' },
  { match: /game|gaming|spiel/i, emoji: '🎮' },
];

export function categoryEmoji(category: string | null, title: string): string {
  const hay = `${category ?? ''} ${title}`;
  for (const c of CATEGORY_EMOJI) if (c.match.test(hay)) return c.emoji;
  return '🎬';
}

/** Ruhiger, dezenter Hintergrund je Challenge-ID: ein weicher, niedrig gesättigter
 *  Farbton, damit die Items unterscheidbar sind, ohne laut zu werden. Kein Poster-
 *  Drama — nur ein angenehmer Grund, der ins neutrale Dunkel ausläuft. */
export function feedGradient(id: string): string {
  let n = 0;
  for (let i = 0; i < id.length; i++) n = (n * 31 + id.charCodeAt(i)) % 1000;
  const h = n % 360; // beliebiger Farbton, aber sehr zurückhaltend gesättigt
  return `linear-gradient(180deg, hsl(${h} 20% 22%) 0%, hsl(${h} 16% 15%) 55%, #16171b 100%)`;
}

/** Freundliche, deterministische Identitätsfarbe je Nutzer/Handle — bringt spielerisch
 *  Leben in Avatare und hilft nebenbei, Nutzer auseinanderzuhalten. Weiche Töne, damit
 *  es bunt-freundlich bleibt, nicht grell. */
const AVATAR_COLORS = [
  '#f2905e', // Koralle
  '#5ec2a0', // Mint
  '#7aa2f7', // Himmelblau
  '#e07a9b', // Rosé
  '#d3a24a', // Bernstein
  '#9b86e6', // Flieder
  '#5bbcd0', // Türkis
  '#e0795e', // Terracotta
];
export function avatarColor(seed: string): string {
  let n = 0;
  for (let i = 0; i < seed.length; i++) n = (n * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[n % AVATAR_COLORS.length];
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

export interface PublicProfile {
  username: string;
  displayName: string | null;
  bio: string | null;
  joinedAt: string;
  createdCount: number;
  participatedCount: number;
  wonCount: number;
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

/** Menschenlesbare Beschriftungen der Challenge-Zustände (Launch-taugliches Deutsch). */
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

/** Farbton (CSS-Klasse) je nach Zustand für konsistente Badges. */
export function statusTone(status: string): 'open' | 'done' | 'warn' | 'neutral' {
  if (status === 'OPEN' || status === 'FULL') return 'open';
  if (status === 'WINNER_LOCKED' || status === 'PAID_OUT') return 'done';
  if (status === 'CANCELLED' || status === 'EXPIRED') return 'warn';
  return 'neutral';
}

export const SELECTION_MODE_LABELS: Record<string, string> = {
  CREATOR_DECIDES: 'Ersteller entscheidet',
  COMMUNITY_VOTE: 'Community-Voting',
};

export function selectionModeLabel(mode: string): string {
  return SELECTION_MODE_LABELS[mode] ?? mode;
}

/** Meldegründe mit deutscher Beschriftung (Reihenfolge = Anzeige, schwere zuerst). */
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
