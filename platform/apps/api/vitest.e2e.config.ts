import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// NestJS-DI benötigt zur Laufzeit Decorator-Metadaten. esbuild (Vitest-Default)
// emittiert diese nicht — daher wird für e2e-Tests mit SWC transpiliert.
export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    include: ['test/**/*.e2e.test.ts'],
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
});
