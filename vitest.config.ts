import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: '.',
    include: ['tests/unit/**/*.test.ts', 'tests/api/**/*.test.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
    // run with a non-Indian timezone to prove all safety logic uses IST
    env: { TZ: 'UTC' },
    pool: 'forks',
  },
});
