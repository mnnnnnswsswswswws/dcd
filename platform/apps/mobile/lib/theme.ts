/** Farb-/Token-Palette der Mobile-App — auf dem "Organic"-Design-System
 *  (claude.ai/design): warmes cremefarbenes Ground, Terracotta-Akzent, Sage-Zweitakzent. */
export const colors = {
  bg: '#f5ead8',
  surface: '#ebddc5',
  surface2: '#f9f4ed',
  border: 'rgba(32,30,29,0.16)',
  text: '#201e1d',
  muted: '#6a6459',
  accent: '#c67139',
  accentInk: '#f5ead8',
  danger: '#b23a2a',
  blue: '#7a8a5e', // Zweitakzent (Sage) für "erledigt"-Zustände
};

/** Schriftfamilien des Organic-Systems (nativ via expo-font geladen). */
export const fonts = {
  heading: 'Caprasimo_400Regular',
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
      return colors.blue;
    case 'warn':
      return colors.danger;
    default:
      return colors.muted;
  }
}
