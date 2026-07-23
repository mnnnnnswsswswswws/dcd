/** Farb-/Token-Palette der Mobile-App — "EMBER EXPEDITION" (identisch mit Web/Admin):
 *  warmes Tinten-Schwarz mit Feuerschein, glühendes Ember→Gold als Action-Farbe,
 *  mattes physisches Material (kein Glas), Gold-Preisgeld, Acid-Lime als "live/offen". */
export const colors = {
  bg: '#100d0b',
  bg2: '#17120e',
  surface: '#1c1611',
  surface2: '#241c15',
  border: 'rgba(255,214,170,0.11)',
  borderStrong: 'rgba(255,214,170,0.2)',
  text: '#f7f0e6',
  muted: '#a99a86',
  faint: '#6f6455',
  accent: '#ff7a2b', // Ember
  accentInk: '#1a0d02',
  ember: '#ff5a1f',
  gold: '#f5c451',
  goldDeep: '#d99a2c',
  lime: '#c6f24e', // die eine kühle Signalfarbe (offen/live)
  green: '#c6f24e', // Alias für „offen"-Zustände (Lime)
  blue: '#f5c451', // Alias für „erledigt" (Gold statt Cyan)
  danger: '#ff5a4d',
};

/** Gradient-Stops für expo-linear-gradient — gegossenes Ember. */
export const gradients = {
  cta: ['#ff5a1f', '#ff8a2b', '#ffb020'] as const,
  create: ['#ff5a1f', '#ffb020'] as const,
  avatar: ['#ff5a1f', '#ffb020'] as const,
};

/** Schriftfamilien (nativ via expo-font geladen). Display = Unbounded (identisch mit
 *  Web/Admin) für Titel, Preisgeld und CTAs; Figtree als Body. */
export const fonts = {
  heading: 'Unbounded_700Bold',
  body: 'Figtree_400Regular',
  bodySemibold: 'Figtree_600SemiBold',
  bodyBold: 'Figtree_700Bold',
};

export type Tone = 'open' | 'done' | 'warn' | 'neutral';

export function statusTone(status: string): Tone {
  if (status === 'OPEN' || status === 'FULL') return 'open';
  if (status === 'WINNER_LOCKED' || status === 'PAID_OUT') return 'done';
  if (status === 'CANCELLED' || status === 'EXPIRED') return 'warn';
  return 'neutral';
}

export function toneColor(tone: Tone): string {
  switch (tone) {
    case 'open':
      return colors.lime;
    case 'done':
      return colors.gold;
    case 'warn':
      return colors.danger;
    default:
      return colors.muted;
  }
}
