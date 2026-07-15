import { defineConfig } from 'vitest/config';

// Unit-Tests: schnell, ohne Datenbank. Integrationstests (DB) laufen separat über
// vitest.integration.config.ts.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['**/*.integration.test.ts', 'node_modules/**'],
    // Integrationstests liegen separat (test/**); Unit-Scope darf leer sein.
    passWithNoTests: true,
  },
});
