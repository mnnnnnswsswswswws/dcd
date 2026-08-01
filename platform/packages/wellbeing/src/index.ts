/**
 * @vcp/wellbeing — Safety, Fairness and Wellbeing by Design (§34).
 *
 * Umsatz und Nutzungsdauer dürfen nicht durch glücksspielähnliche oder manipulative
 * Mechaniken maximiert werden. Dieses Paket bündelt die Schutzlogik:
 *   • Ausgabenlimits mit asymmetrischer Änderung (Senkung sofort, Erhöhung mit Frist)
 *   • Schutzpausen und Selbstausschluss
 *   • Interventionsstufen, Nutzungszeit-Hinweise, Ruhezeiten, Teilnehmerschutz
 *
 * Reine Domänenlogik, damit dieselben Regeln in API, Workern und Tests gelten.
 */

export * from './spending-limits.js';
export * from './protection-pauses.js';
export * from './risk-engine.js';
