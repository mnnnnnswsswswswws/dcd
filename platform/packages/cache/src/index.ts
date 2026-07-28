/**
 * @vcp/cache — Lese-Beschleunigung ohne Autorität (Scale S1).
 *
 * Der Cache fängt virale Lasten ab, entscheidet aber nie. Fällt Redis aus, wird der
 * Pfad langsamer, nicht falsch. Private Antworten können strukturell nicht unter
 * geteilten Schlüsseln landen.
 */

export * from './keys.js';
export * from './cache.js';
export * from './redis-roles.js';
