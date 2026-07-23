/** Farb-/Token-Palette der Mobile-App — ruhiges, komfortables Design (identisch mit
 *  Web/Admin): weiches neutrales Dunkel, EIN Akzent (Grün = Geld/positiv/aktiv), Rot
 *  nur fürs Herz/Gefahr. Simpel, lesbar, funktional — kein Feuer, kein Glow. */
export const colors = {
  bg: '#16171b',
  bg2: '#1b1d22',
  surface: '#1f2229',
  surface2: '#262a32',
  border: 'rgba(255,255,255,0.09)',
  borderStrong: 'rgba(255,255,255,0.15)',
  text: '#edeff3',
  muted: '#9aa1ac',
  faint: '#6c727c',
  accent: '#46c98a', // Geld / positiv / aktiv / primäre Aktion
  accent2: '#3bb87c',
  accentInk: '#08130d',
  gold: '#46c98a', // Alias: Preisgeld nutzt den Akzent (Grün = Geld)
  green: '#46c98a', // Alias: „offen"-Zustände
  blue: '#9aa1ac', // Alias: „erledigt" = neutral
  like: '#f26d72',
  danger: '#f26d72',
};

/** Gradient-Stops für expo-linear-gradient — ruhig (einfarbig gehalten). */
export const gradients = {
  cta: ['#46c98a', '#3bb87c'] as const,
  create: ['#46c98a', '#3bb87c'] as const,
  avatar: ['#262a32', '#262a32'] as const,
};

/** Schriftfamilien (nativ via expo-font geladen). Figtree durchgehend — ruhig und
 *  lesbar; keine Display-Dramatik. */
export const fonts = {
  heading: 'Figtree_700Bold',
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
      return colors.accent;
    case 'done':
      return colors.text;
    case 'warn':
      return colors.danger;
    default:
      return colors.muted;
  }
}
