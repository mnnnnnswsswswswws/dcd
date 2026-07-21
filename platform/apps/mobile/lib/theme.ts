/** Zentrale Farb-/Abstands-Token der Mobile-App (mobil, kompakt, ein Akzent). */
export const colors = {
  bg: '#fbfbfd',
  surface: '#ffffff',
  surface2: '#f2f2f6',
  border: '#e3e3ea',
  text: '#1a1a20',
  muted: '#6b6b76',
  accent: '#2f9e44',
  accentInk: '#ffffff',
  danger: '#c92a2a',
  blue: '#4263eb',
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
