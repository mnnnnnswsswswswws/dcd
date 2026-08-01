import { defineConfig } from 'vitest/config';

// Integrationstests benötigen eine laufende PostgreSQL-Instanz (DATABASE_URL) mit
// angewandtem Prisma-Schema. Sie laufen seriell, damit der Concurrency-Test die
// Datenbank exklusiv nutzt.
export default defineConfig({
  test: {
    include: ['test/**/*.integration.test.ts'],
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
});
