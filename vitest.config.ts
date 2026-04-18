import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['src/__tests__/setup.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.claude/worktrees/**',
      '**/e2e/**',
    ],
  },
});
