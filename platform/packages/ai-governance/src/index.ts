/**
 * @vcp/ai-governance — KI unterstützt, sie entscheidet nicht endgültig (§35, §36).
 *
 * Der EU AI Act wird als Mindeststandard behandelt. Dieses Paket liefert:
 *   • Model-/Policy-Registry mit Deployment-Schwellen (keine stillen Updates)
 *   • die Entscheidungsmatrix: Policy Engine autoritativ, im Zweifel Mensch
 *   • Reason Statements mit Rechtsbehelf
 *   • Einspruchsverfahren, das eine echte Neubewertung erzwingt
 */

export * from './registry.js';
export * from './decisions.js';
export * from './appeals.js';
