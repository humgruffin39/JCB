import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@jcb/application': `${root}packages/application/src/index.ts`,
      '@jcb/config': `${root}packages/config/src/index.ts`,
      '@jcb/contracts': `${root}packages/contracts/src/index.ts`,
      '@jcb/database': `${root}packages/database/src/index.ts`,
      '@jcb/discord': `${root}packages/discord/src/index.ts`,
      '@jcb/domain': `${root}packages/domain/src/index.ts`,
      '@jcb/economy': `${root}packages/economy/src/index.ts`,
      '@jcb/odds': `${root}packages/odds/src/index.ts`,
      '@jcb/simulation': `${root}packages/simulation/src/index.ts`,
      '@jcb/test-support': `${root}packages/test-support/src/index.ts`,
      '@jcb/ui': `${root}packages/ui/src/index.ts`,
    },
  },
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['apps/*/src/**/*.{ts,tsx}', 'packages/*/src/**/*.{ts,tsx}'],
      exclude: ['**/*.test.ts', '**/*.integration.test.ts', '**/*.e2e.test.ts', '**/vite-env.d.ts'],
      thresholds: {
        statements: 38,
        branches: 32,
        functions: 40,
        lines: 39,
      },
    },
  },
});
