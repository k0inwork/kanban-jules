import { describe, it, expect } from 'vitest';
import { Sandbox } from './sandbox';

describe('Sandbox', () => {
  it('should execute basic javascript', async () => {
    const sandbox = new Sandbox();
    const result = await sandbox.execute('return 1 + 1;');
    expect(result).toBe(2);
  });

  it('should support injected APIs', async () => {
    const sandbox = new Sandbox();
    sandbox.inject('testAPI', {
      multiply: (a: number, b: number) => a * b
    });
    
    const result = await sandbox.execute('return testAPI.multiply(3, 4);');
    expect(result).toBe(12);
  });

  it('should support async execution', async () => {
    const sandbox = new Sandbox();
    sandbox.inject('asyncAPI', {
      fetchData: async () => {
        return new Promise(resolve => setTimeout(() => resolve('data'), 10));
      }
    });
    
    const result = await sandbox.execute('const data = await asyncAPI.fetchData(); return data;');
    expect(result).toBe('data');
  });
});
