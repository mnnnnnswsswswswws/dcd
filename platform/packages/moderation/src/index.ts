/**
 * @vcp/moderation — deterministische Policy Engine und Moderationskontrakte (§14, §35).
 *
 * Läuft vor jeder Modellentscheidung und ist autoritativ. Ein Treffer kann sperren
 * oder eskalieren, aber niemals freigeben — die Freigabe entscheidet die Gesamtmatrix
 * aus Regeln, Modellen und menschlicher Prüfung.
 */

export * from './policy-codes.js';
export * from './policy-engine.js';
