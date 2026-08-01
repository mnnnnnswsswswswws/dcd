# Design Tokens

Konkrete Werte der visuellen Identität. Quelle der Wahrheit für Web (`globals.css`),
Mobile (`lib/theme.ts`) und Admin. Jede Entscheidung ist begründet.

## Farbe (Rollen, nicht Deko)
| Token | Wert | Rolle / Begründung |
| --- | --- | --- |
| `--bg` | `#16171b` | Bühne. Warmes Neutral-Dunkel, angenehm beim langen Scrollen; lässt Inhalt leuchten. |
| `--bg-2` | `#1b1d22` | Leiste/Feld-Grund, eine Stufe heller. |
| `--surface` | `#1f2229` | Karte/Fläche. |
| `--surface-2` | `#262a32` | Erhöhte Fläche / Sekundär-Button. |
| `--line` | `rgba(255,255,255,.09)` | Haarlinie, ruhige Trennung ohne Kästchen-Optik. |
| `--line-2` | `rgba(255,255,255,.15)` | Betonte Kante / Fokus. |
| `--text` | `#edeff3` | Primärtext, weiches Weiß (kein hartes #fff). |
| `--muted` | `#9aa1ac` | Sekundärtext. |
| `--faint` | `#6c727c` | Tertiär / Labels. |
| `--accent` | `#46c98a` | **Signatur:** Geld / positiv / aktiv / primäre Aktion. |
| `--accent-2` | `#3bb87c` | Akzent gedrückt/hover. |
| `--accent-ink` | `#08130d` | Text auf Akzent (dunkel für Kontrast). |
| `--like` | `#f26d72` | Herz / Gefahr — die einzige „warme" Rolle. |
| Identitätsfarben | Koralle/Mint/Blau/Rosé/Bernstein/Flieder/Türkis/Terracotta | Nur für Menschen/Items (Avatare) — bringt Leben, unterscheidet Nutzer. |

## Typografie
- Familie: **Figtree** (durchgehend). Humanist, freundlich, lesbar — nicht steif, nicht verspielt-kindlich.
- Skala/Rollen:
  | Rolle | Größe | Gewicht |
  | --- | --- | --- |
  | Held-Zahl (Preisgeld) | 2.4–3rem | 800 |
  | Display/Titel | 1.5–1.7rem | 800 |
  | Sektionstitel | 1.1rem | 700 |
  | Body | 0.95–1rem | 400–500 |
  | Label/Eyebrow | 0.7rem, `letter-spacing .12em`, uppercase | 700 |

## Abstände — 4-Punkt-Raster
`4 · 8 · 12 · 16 · 20 · 24 · 32 · 44`. Keine Zwischenwerte ohne Grund.

## Radien
| Token | Wert | Einsatz |
| --- | --- | --- |
| klein | 8–11px | Badges, Inputs, kleine Buttons |
| mittel | 14–16px | Buttons, Chips |
| groß | 18–22px | Karten, Sheets |
| rund | 50% | Avatare, Live-Punkt |

## Bewegung (benannte Eases)
| Token | Kurve | Einsatz |
| --- | --- | --- |
| `--ease` | `cubic-bezier(.22,1,.36,1)` | Übergänge, Fades |
| `--spring` | `cubic-bezier(.34,1.56,.64,1)` | Feder/Bounce: Tap, Pop, Einstieg |
- Tap-Feedback 80–150 ms · Übergang 200–350 ms · Feier ≤ 600 ms.
- `prefers-reduced-motion`: Loops aus, Bewegung → Fade.

## Ikonografie
- Eine Strichstärke (2px), runde Enden, konsistente 24px-Box (inline SVG in `icons.tsx`).

## Elevation-Logik
Tiefe entsteht durch **Flächenhelligkeit + Haarlinie**, nicht durch große Schatten oder
Blur. Karten heben sich um eine Helligkeitsstufe ab, Fokus über `--line-2`.
