export interface WebConfig {
  apiBase: string;
  token: string;
}

const API_BASE_KEY = 'vcp.web.apiBase';
const TOKEN_KEY = 'vcp.web.token';

export function getConfig(): WebConfig {
  if (typeof window === 'undefined') {
    return { apiBase: 'http://localhost:8080', token: '' };
  }
  return {
    apiBase: window.localStorage.getItem(API_BASE_KEY) ?? 'http://localhost:8080',
    token: window.localStorage.getItem(TOKEN_KEY) ?? '',
  };
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

/** Registriert einen volljährigen Nutzer und speichert die ID als Token. */
export async function register(): Promise<string> {
  const user = await api<{ id: string }>('/v1/users', { method: 'POST', body: { isAdult: true }, auth: false });
  setToken(user.id);
  return user.id;
}

export interface ChallengeSummary {
  id: string;
  status: string;
  selectionMode: string;
  prizeAmountCents: number;
  maxSlots: number;
  submissionDeadline: string | null;
  createdAt: string;
}

export interface ChallengeDetail extends ChallengeSummary {
  occupiedSlots: number;
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

export interface FeedEntry {
  id: string;
  status: string;
  selectionMode: string;
  prizeAmountCents: number;
  decidedAt: string;
  winner: { winnerSubmissionId: string | null; decisionSource: string } | null;
}

export function euro(cents: number): string {
  return `${(cents / 100).toFixed(2)} €`;
}
