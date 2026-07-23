/**
 * Zentraler Demo-Store — die eine Quelle der Wahrheit für den dynamischen Flow.
 *
 * Nutzeraktionen und Zeit ändern hier ECHTEN State (kein verstreutes setTimeout in
 * Komponenten). Feed und Profil lesen denselben Store → jede Änderung ist überall
 * sofort sichtbar. Countdowns leiten sich aus Ablauf-Timestamps ab (`now` tickt
 * zentral). Szenarien A–D erzwingen reproduzierbar Sonderfälle (Slot weg, Upload-
 * Abbruch, Frist endet). Siehe docs/design/INTERACTION_STATE_MATRIX.md.
 */

export type ChallengeStatus = 'open' | 'full' | 'closed' | 'voting';
export type UploadStatus =
  | 'PREPARING'
  | 'QUEUED'
  | 'UPLOADING'
  | 'PAUSED'
  | 'RETRYING'
  | 'PROCESSING'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'FAILED'
  | 'CANCELLED';
export type Scenario = 'A' | 'B' | 'C' | 'D';

export interface Creator {
  username: string;
  displayName: string;
  color: string;
}
export interface DemoChallenge {
  id: string;
  title: string;
  category: string;
  emoji: string;
  creator: Creator;
  prizeCents: number;
  maxSlots: number;
  occupiedSlots: number;
  createdAt: number;
  expiresAt: number; // Frist (Deadline)
  status: ChallengeStatus;
  commentCount: number;
  hue: number;
}
export interface Reservation {
  challengeId: string;
  expiresAt: number; // now + TTL
}
export interface Submission {
  challengeId: string;
  status: 'processing' | 'accepted' | 'rejected';
  at: number;
}
export interface UploadState {
  challengeId: string;
  progress: number; // 0..1
  status: UploadStatus;
  retries: number;
}
export interface DemoEvent {
  type: string;
  at: number;
  challengeId?: string;
}
export interface DemoState {
  now: number;
  loading: boolean;
  scenario: Scenario;
  challenges: DemoChallenge[];
  saved: Record<string, true>;
  reservation: Reservation | null;
  submissions: Submission[];
  upload: UploadState | null;
  events: DemoEvent[];
}

const TTL = 10 * 60 * 1000; // 10 Min Reservierung
const c = (n: number) => n * 100;

const CREATORS: Creator[] = [
  { username: 'lena_skates', displayName: 'Lena', color: '#7aa2f7' },
  { username: 'max_air', displayName: 'Max', color: '#f2905e' },
  { username: 'ayla_cooks', displayName: 'Ayla', color: '#5ec2a0' },
  { username: 'nomad_jon', displayName: 'Jon', color: '#e07a9b' },
  { username: 'beatz_mia', displayName: 'Mia', color: '#9b86e6' },
  { username: 'coach_theo', displayName: 'Theo', color: '#d3a24a' },
];

function mkChallenge(
  i: number,
  title: string,
  category: string,
  emoji: string,
  hue: number,
  prize: number,
  maxSlots: number,
  occupied: number,
  minutesLeft: number,
  status: ChallengeStatus,
): DemoChallenge {
  const now = Date.now();
  return {
    id: `demo-${i}`,
    title,
    category,
    emoji,
    creator: CREATORS[i % CREATORS.length],
    prizeCents: c(prize),
    maxSlots,
    occupiedSlots: occupied,
    createdAt: now - i * 3_600_000,
    expiresAt: now + minutesLeft * 60_000,
    status,
    commentCount: 3 + ((i * 7) % 40),
    hue,
  };
}

/** 12 glaubwürdige Challenges: verschiedene Kategorien, Preisgelder, Laufzeiten,
 *  Teilnehmerzahlen und Status (offen/neu/fast voll/voll/Abstimmung/beendet). */
function seedChallenges(): DemoChallenge[] {
  return [
    mkChallenge(0, 'Kickflip über 5 Stufen', 'Sport', '🛹', 210, 150, 10, 4, 60 * 24 * 6, 'open'),
    mkChallenge(1, 'Pasta in unter 10 Minuten', 'Kochen', '🍝', 30, 80, 10, 9, 90, 'open'), // fast voll
    mkChallenge(2, '30 Sekunden, ein Lacher', 'Comedy', '😂', 280, 50, 8, 8, 60 * 5, 'full'), // voll
    mkChallenge(3, 'Freestyle zu einem Beat', 'Musik', '🎤', 265, 120, 12, 3, 60 * 24 * 2, 'open'),
    mkChallenge(4, '100 Liegestütze am Stück', 'Fitness', '💪', 12, 60, 10, 6, 60 * 10, 'open'),
    mkChallenge(5, 'Latte-Art, die sitzt', 'Kreatives', '☕', 24, 40, 6, 5, 45, 'open'), // fast voll, bald Frist
    mkChallenge(6, 'No-Scope aus der Distanz', 'Gaming', '🎮', 150, 200, 10, 2, 60 * 24 * 3, 'open'),
    mkChallenge(7, 'Ein Trick, den keiner glaubt', 'Mut', '🔥', 8, 500, 10, 10, 60 * 2, 'voting'), // in Abstimmung
    mkChallenge(8, 'Sonnenaufgang in 15 Sek', 'Reise', '🌄', 35, 90, 15, 1, 60 * 24 * 9, 'open'),
    mkChallenge(9, 'Bau was aus Karton', 'DIY', '🛠️', 40, 70, 8, 3, 60 * 24, 'open'),
    mkChallenge(10, 'Ein Portrait in einer Linie', 'Kunst', '🎨', 320, 55, 6, 2, 60 * 8, 'open'),
    mkChallenge(11, 'Der beste Streetfood-Move', 'Kochen', '🌮', 20, 110, 10, 7, 30, 'open'), // bald Frist
  ];
}

/* ------------------------------- Store ------------------------------- */
type Listener = () => void;

let state: DemoState = {
  now: Date.now(),
  loading: true,
  scenario: 'A',
  challenges: [],
  saved: {},
  reservation: null,
  submissions: [],
  upload: null,
  events: [],
};

const listeners = new Set<Listener>();
function emit() {
  state = { ...state };
  listeners.forEach((l) => l());
}
function log(type: string, challengeId?: string) {
  state.events = [{ type, at: Date.now(), challengeId }, ...state.events].slice(0, 60);
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function getState(): DemoState {
  return state;
}

/** Einmalige Initialisierung inkl. einer bereits reservierten und einer bereits
 *  eingereichten Challenge — damit der Ausgangszustand wie echter Betrieb wirkt. */
let started = false;
export function ensureStarted(): void {
  if (started) return;
  started = true;
  const challenges = seedChallenges();
  // Eine bereits eingereichte Challenge (Profil hat Historie).
  const submissions: Submission[] = [{ challengeId: challenges[4].id, status: 'accepted', at: Date.now() - 3_600_000 }];
  state = { ...state, loading: false, challenges, submissions };
  emit();
  // Zentraler 1-Sekunden-Tick: treibt Countdowns, Ablauf, Szenarien.
  setInterval(tick, 1000);
}

function tick() {
  const now = Date.now();
  state.now = now;

  // Reservierung abgelaufen → Slot zurück, Event.
  if (state.reservation && state.reservation.expiresAt <= now) {
    const ch = state.challenges.find((x) => x.id === state.reservation!.challengeId);
    if (ch) ch.occupiedSlots = Math.max(0, ch.occupiedSlots - 1);
    log('slot_expired', state.reservation.challengeId);
    state.reservation = null;
  }

  // Frist abgelaufen → Status auf beendet.
  for (const ch of state.challenges) {
    if (ch.status === 'open' && ch.expiresAt <= now) {
      ch.status = 'closed';
      log('challenge_closed', ch.id);
    }
  }
  emit();
}

/* ------------------------------ Aktionen ----------------------------- */
export function setScenario(s: Scenario) {
  state.scenario = s;
  log('scenario_set');
  emit();
}

export function toggleSave(id: string): boolean {
  const next = { ...state.saved };
  const nowSaved = !next[id];
  if (nowSaved) next[id] = true;
  else delete next[id];
  state.saved = next;
  log(nowSaved ? 'challenge_saved' : 'challenge_unsaved', id);
  emit();
  return nowSaved;
}

export type ReserveResult = { ok: true } | { ok: false; reason: string };

/** Slot reservieren. Szenario B: der letzte Platz wird „während der Reservierung"
 *  vergeben → schlägt fehl und der Feed zeigt die Challenge als voll. */
export function reserve(id: string): ReserveResult {
  const ch = state.challenges.find((x) => x.id === id);
  if (!ch) return { ok: false, reason: 'Challenge nicht gefunden.' };
  if (ch.status !== 'open') return { ok: false, reason: 'Diese Challenge nimmt keine Teilnehmer mehr an.' };

  if (state.scenario === 'B') {
    // Jemand anderes schnappt sich den letzten Platz.
    ch.occupiedSlots = ch.maxSlots;
    ch.status = 'full';
    log('slot_taken_by_other', id);
    emit();
    return { ok: false, reason: 'Gerade zu spät — der letzte Platz ist weg.' };
  }
  if (ch.occupiedSlots >= ch.maxSlots) {
    ch.status = 'full';
    emit();
    return { ok: false, reason: 'Diese Challenge ist voll.' };
  }

  ch.occupiedSlots += 1;
  if (ch.occupiedSlots >= ch.maxSlots) ch.status = 'full';
  state.reservation = { challengeId: id, expiresAt: Date.now() + TTL };
  log('slot_reserved', id);
  emit();
  return { ok: true };
}

export function cancelReservation() {
  if (!state.reservation) return;
  const ch = state.challenges.find((x) => x.id === state.reservation!.challengeId);
  if (ch) {
    ch.occupiedSlots = Math.max(0, ch.occupiedSlots - 1);
    if (ch.status === 'full' && ch.occupiedSlots < ch.maxSlots) ch.status = 'open';
  }
  log('reservation_cancelled', state.reservation.challengeId);
  state.reservation = null;
  emit();
}

export function reservationRemainingMs(): number {
  if (!state.reservation) return 0;
  return Math.max(0, state.reservation.expiresAt - state.now);
}

/* --------------------------- Upload-Maschine -------------------------- */
let uploadTimer: ReturnType<typeof setInterval> | null = null;

function stopUploadTimer() {
  if (uploadTimer) {
    clearInterval(uploadTimer);
    uploadTimer = null;
  }
}

/** Zentral gesteuerter Upload (im Store, nicht in der Komponente). Unterstützt
 *  Pause/Resume/Abbruch/Fehler. Szenario C: verliert bei ~50 % die Verbindung und
 *  nimmt automatisch wieder auf. */
export function startUpload(challengeId: string) {
  stopUploadTimer();
  state.upload = { challengeId, progress: 0, status: 'QUEUED', retries: 0 };
  log('upload_started', challengeId);
  emit();
  runUpload();
}

function runUpload() {
  stopUploadTimer();
  if (state.upload) state.upload.status = 'UPLOADING';
  emit();
  uploadTimer = setInterval(() => {
    const u = state.upload;
    if (!u || (u.status !== 'UPLOADING' && u.status !== 'RETRYING')) {
      stopUploadTimer();
      return;
    }
    u.progress = Math.min(1, u.progress + 0.06);

    // Szenario C: bei ~50 % Verbindung verlieren, dann auto-resume.
    if (state.scenario === 'C' && u.retries === 0 && u.progress >= 0.5) {
      u.status = 'RETRYING';
      u.retries = 1;
      log('upload_connection_lost', u.challengeId);
      stopUploadTimer();
      emit();
      setTimeout(() => {
        if (state.upload && state.upload.status === 'RETRYING') {
          log('upload_resumed', state.upload.challengeId);
          runUpload();
        }
      }, 1600);
      return;
    }

    if (u.progress >= 1) {
      u.progress = 1;
      u.status = 'PROCESSING';
      log('upload_completed', u.challengeId);
      stopUploadTimer();
      emit();
      // Verarbeitung → akzeptiert (Szenario … könnte ablehnen; hier akzeptiert).
      setTimeout(() => finishSubmission(u.challengeId), 1200);
      return;
    }
    emit();
  }, 200);
}

export function pauseUpload() {
  if (state.upload && (state.upload.status === 'UPLOADING' || state.upload.status === 'RETRYING')) {
    state.upload.status = 'PAUSED';
    stopUploadTimer();
    log('upload_paused', state.upload.challengeId);
    emit();
  }
}
export function resumeUpload() {
  if (state.upload && state.upload.status === 'PAUSED') {
    log('upload_resumed', state.upload.challengeId);
    runUpload();
  }
}
export function retryUpload() {
  if (state.upload && (state.upload.status === 'FAILED' || state.upload.status === 'RETRYING')) {
    state.upload.retries += 1;
    runUpload();
  }
}
export function cancelUpload() {
  if (state.upload) {
    stopUploadTimer();
    log('upload_cancelled', state.upload.challengeId);
    state.upload = null;
    emit();
  }
}

function finishSubmission(challengeId: string) {
  // Einsendung akzeptiert → Reservierung wird zur Einsendung, Profil bekommt Eintrag,
  // Karte im Feed wechselt sichtbar den Status.
  state.submissions = [{ challengeId, status: 'accepted', at: Date.now() }, ...state.submissions.filter((s) => s.challengeId !== challengeId)];
  if (state.reservation?.challengeId === challengeId) state.reservation = null;
  const ch = state.challenges.find((x) => x.id === challengeId);
  if (ch) ch.status = ch.occupiedSlots >= ch.maxSlots ? 'full' : ch.status;
  if (state.upload?.challengeId === challengeId) state.upload.status = 'ACCEPTED';
  log('submission_accepted', challengeId);
  emit();
}

/* ------------------------------ Selektoren ---------------------------- */
export function hasSubmitted(challengeId: string): boolean {
  return state.submissions.some((s) => s.challengeId === challengeId && s.status === 'accepted');
}
export function isSaved(challengeId: string): boolean {
  return Boolean(state.saved[challengeId]);
}
