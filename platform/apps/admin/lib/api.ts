export interface AdminConfig {
  apiBase: string;
  token: string;
}

const API_BASE_KEY = 'vcp.apiBase';
const TOKEN_KEY = 'vcp.token';

/** Standard-API-Basis aus `NEXT_PUBLIC_API_BASE` (Launch) mit lokalem Fallback. */
const DEFAULT_API_BASE =
  process.env.NEXT_PUBLIC_API_BASE && process.env.NEXT_PUBLIC_API_BASE.length > 0
    ? process.env.NEXT_PUBLIC_API_BASE
    : 'http://localhost:8080';

export function getConfig(): AdminConfig {
  if (typeof window === 'undefined') {
    return { apiBase: DEFAULT_API_BASE, token: '' };
  }
  return {
    apiBase: window.localStorage.getItem(API_BASE_KEY) ?? DEFAULT_API_BASE,
    token: window.localStorage.getItem(TOKEN_KEY) ?? '',
  };
}

export function setConfig(config: AdminConfig): void {
  window.localStorage.setItem(API_BASE_KEY, config.apiBase);
  window.localStorage.setItem(TOKEN_KEY, config.token);
}

export interface ApiOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
}

/** Ruft die Plattform-API mit dem hinterlegten Admin-Token auf. */
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
    const message =
      (parsed as { error?: { message?: string } } | null)?.error?.message ?? res.statusText;
    throw new Error(message);
  }
  return parsed as T;
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
}

export interface SubmissionRow {
  id: string;
  participantId: string;
  status: string;
  finalizedAt: string | null;
  createdAt: string;
  voteCount: number;
}

export const CHALLENGE_STATUSES = [
  'DRAFT',
  'PENDING_FUNDING',
  'OPEN',
  'FULL',
  'SUBMISSIONS_CLOSED',
  'IN_REVIEW',
  'SELECTION',
  'WINNER_LOCKED',
  'PAID_OUT',
  'CANCELLED',
  'EXPIRED',
] as const;

export function euro(cents: number): string {
  return `${(cents / 100).toFixed(2)} €`;
}
