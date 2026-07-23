/** Farb-/Token-Palette der Mobile-App — "Liquid Glass"-Design wie im Web:
 *  near-black Grund mit Lila/Blau-Aurora, Glas-Oberflächen (Transluzenz + Blur),
 *  Violett-Gradient-CTAs, grünes Preisgeld. */
export const colors = {
  bg: '#0b0b12',
  surface: 'rgba(255,255,255,0.07)',
  surface2: 'rgba(255,255,255,0.11)',
  border: 'rgba(255,255,255,0.16)',
  glass: 'rgba(22,22,38,0.55)',
  glassBorder: 'rgba(255,255,255,0.18)',
  text: '#f5f5fa',
  muted: '#9a9ab4',
  accent: '#8b5cf6',
  accentInk: '#ffffff',
  green: '#34d98a',
  danger: '#ff5d6c',
  blue: '#22d3ee', // Zweitakzent (Cyan) für "erledigt"-Zustände
};

/** Gradient-Stops für expo-linear-gradient (CTA & Create wie im Web). */
export const gradients = {
  cta: ['#7c4dff', '#5b7cff'] as const,
  create: ['#22d3ee', '#34d98a'] as const,
  avatar: ['#6d5cff', '#22d3ee'] as const,
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
      return colors.green;
    case 'done':
      return colors.blue;
    case 'warn':
      return colors.danger;
    default:
      return colors.muted;
  }
}
