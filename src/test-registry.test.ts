import { describe, it, expect } from 'vitest';
import { registry } from './core/registry';
import { composeArchitectPrompt } from './core/prompt';

describe('Module Registry and Prompt Composition', () => {
  it('should register all modules', () => {
    const modules = registry.getAll();
    expect(modules.length).toBeGreaterThan(0);
    expect(modules.find(m => m.id === 'architect-codegen')).toBeDefined();
    expect(modules.find(m => m.id === 'executor-local')).toBeDefined();
    expect(modules.find(m => m.id === 'executor-github')).toBeDefined();
    expect(modules.find(m => m.id === 'knowledge-local-analyzer')).toBeDefined();
  });

  it('should compose architect prompt with available executors', () => {
    const modules = registry.getAll();
    const prompt = composeArchitectPrompt(modules);
    // Executor section uses format: ## Executor ID: "{id}" + Name: {name}
    expect(prompt).toContain('Name: Google Jules');
    // architect-codegen has type 'architect', not 'executor', so it is excluded from executors
    expect(prompt).not.toContain('Architect Codegen');
  });
});
