/**
 * @vcp/compliance — Compliance als Domänenlogik (§33, §34.1, §40).
 *
 * Enthält die Bausteine, die das Geschäftsmodell legal und fair halten:
 *   • Legal Launch Gates — ohne Freigabe kein Echtgeld, keine öffentliche Reichweite
 *   • Anti-Glücksspiel-Invarianten — nicht abschaltbar, ohne Override
 *   • Stop-the-Line-Bedingungen — ein Signal genügt, um einen Rollout zu stoppen
 *
 * Bewusst ohne Framework-, Datenbank- oder Netzwerkabhängigkeiten, damit dieselbe
 * Logik in API, Workern, Admin und Tests identisch gilt.
 */

export * from './launch-gates.js';
export * from './anti-gambling.js';
export * from './stop-the-line.js';
