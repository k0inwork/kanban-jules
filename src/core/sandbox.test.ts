import { describe, it } from 'vitest';

/**
 * Sandbox tests require a browser Worker environment.
 * These are skipped in Node.js vitest; they run in browser E2E.
 */
describe.skip('Sandbox', () => {
  it('should execute basic javascript', async () => {
    // Requires Web Worker API — tested in browser E2E
  });

  it('should support injected APIs', async () => {
    // Requires Web Worker API — tested in browser E2E
  });

  it('should support async execution', async () => {
    // Requires Web Worker API — tested in browser E2E
  });
});
