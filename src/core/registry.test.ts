import { describe, it, expect } from 'vitest';
import { ModuleRegistry } from './registry';

describe('ModuleRegistry', () => {
  it('should register and retrieve modules', () => {
    const registry = new ModuleRegistry();
    const modules = registry.getAll();
    expect(modules.length).toBeGreaterThan(0);
    
    // Check for specific modules
    const jules = registry.get('executor-jules');
    expect(jules).toBeDefined();
    expect(jules?.name).toBe('Google Jules');
    
    const userNegotiator = registry.get('channel-user-negotiator');
    expect(userNegotiator).toBeDefined();
    expect(userNegotiator?.name).toBe('User Negotiator');
  });

  it('should return undefined for non-existent module', () => {
    const registry = new ModuleRegistry();
    const notFound = registry.get('non-existent-module');
    expect(notFound).toBeUndefined();
  });
});
