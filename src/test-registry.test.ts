import { describe, it, expect } from 'vitest';
import { registry } from './core/registry';
import { composeArchitectPrompt } from './core/prompt';

describe('Module Registry and Prompt Composition', () => {
  it('should register all modules', () => {
    const modules = registry.getAll();
    expect(modules.length).toBeGreaterThanOrEqual(6);
  });

  it('should compose architect prompt with available executors', () => {
    const modules = registry.getAll();
    const prompt = composeArchitectPrompt(modules);
    expect(prompt).toContain('Executor ID: "executor-jules"');
  });
});
