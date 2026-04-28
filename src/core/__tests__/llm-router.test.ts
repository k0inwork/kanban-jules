import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LlmRouter, LlmRuntime } from '../llm-router';
import { LlmLevel, ESCALATION_ORDER, CALL_LEVELS } from '../llm-levels';

// Mock paw-shadow to avoid IndexedDB in tests
vi.mock('../paw-shadow', () => ({
  shadowLog: vi.fn(),
}));

// Mock paw-programs
vi.mock('../paw-programs', () => ({
  PAW_PROGRAMS: {},
  getActiveVariant: vi.fn(),
}));

describe('LlmRouter', () => {
  let router: LlmRouter;

  beforeEach(() => {
    router = new LlmRouter();
    vi.clearAllMocks();
  });

  describe('route()', () => {
    it('should call API caller for global level', async () => {
      const apiCaller = vi.fn().mockResolvedValue('result');
      router.setApiCaller(apiCaller);

      const result = await router.route('global', 'test prompt', false);

      expect(result).toBe('result');
      expect(apiCaller).toHaveBeenCalledWith('test prompt', false);
    });

    it('should use runtime when available and ready', async () => {
      const mockRuntime: LlmRuntime = {
        level: 'static',
        ready: true,
        infer: vi.fn().mockResolvedValue('SIGNAL'),
      };
      router.registerRuntime(mockRuntime);
      router.setApiCaller(vi.fn().mockResolvedValue('API result'));

      const result = await router.route('static', 'test');

      expect(result).toBe('SIGNAL');
      expect(mockRuntime.infer).toHaveBeenCalledWith('test', undefined);
    });

    it('should escalate from static to global when no runtime', async () => {
      const apiCaller = vi.fn().mockResolvedValue('global result');
      router.setApiCaller(apiCaller);

      const result = await router.route('static', 'test');

      expect(result).toBe('global result');
    });

    it('should escalate when runtime fails', async () => {
      const mockRuntime: LlmRuntime = {
        level: 'static',
        ready: true,
        infer: vi.fn().mockRejectedValue(new Error('crash')),
      };
      router.registerRuntime(mockRuntime);
      const apiCaller = vi.fn().mockResolvedValue('fallback');
      router.setApiCaller(apiCaller);

      const result = await router.route('static', 'test');

      expect(result).toBe('fallback');
    });

    it('should escalate from static through dynamic to global', async () => {
      const dynamicRuntime: LlmRuntime = {
        level: 'dynamic',
        ready: true,
        infer: vi.fn().mockRejectedValue(new Error('fail')),
      };
      router.registerRuntime(dynamicRuntime);
      const apiCaller = vi.fn().mockResolvedValue('global');
      router.setApiCaller(apiCaller);

      const result = await router.route('static', 'test');

      expect(result).toBe('global');
      expect(dynamicRuntime.infer).toHaveBeenCalled();
    });

    it('should throw if no API caller registered for global', async () => {
      await expect(router.route('global', 'test')).rejects.toThrow('No API caller');
    });
  });

  describe('stats', () => {
    it('should track global calls', async () => {
      router.setApiCaller(vi.fn().mockResolvedValue('ok'));
      await router.route('global', 'test');

      const stats = router.getStats();
      expect(stats.global).toBe(1);
      expect(stats.static).toBe(0);
      expect(stats.dynamic).toBe(0);
    });

    it('should track static calls', async () => {
      const runtime: LlmRuntime = {
        level: 'static',
        ready: true,
        infer: vi.fn().mockResolvedValue('ok'),
      };
      router.registerRuntime(runtime);
      router.setApiCaller(vi.fn().mockResolvedValue('ok'));

      await router.route('static', 'test');

      const stats = router.getStats();
      expect(stats.static).toBe(1);
    });

    it('should track escalated calls', async () => {
      router.setApiCaller(vi.fn().mockResolvedValue('ok'));
      await router.route('static', 'test');

      const stats = router.getStats();
      expect(stats.escalated).toBe(1);
    });

    it('should not count as escalated when runtime is used directly', async () => {
      const runtime: LlmRuntime = {
        level: 'static',
        ready: true,
        infer: vi.fn().mockResolvedValue('ok'),
      };
      router.registerRuntime(runtime);
      router.setApiCaller(vi.fn().mockResolvedValue('ok'));

      await router.route('static', 'test');

      const stats = router.getStats();
      expect(stats.escalated).toBe(0);
    });
  });
});

describe('llm-levels', () => {
  it('should have correct escalation order', () => {
    expect(ESCALATION_ORDER).toEqual(['static', 'dynamic', 'global']);
  });

  it('should have all call sites mapped', () => {
    const expectedSites = [
      'signal-noise',
      'format-validate',
      'verify-progress',
      'verify-output',
      'task-extract',
      'session-analyze',
      'architect-plan',
      'programmer-codegen',
      'analyze-tool',
      'project-review',
    ];
    for (const site of expectedSites) {
      expect(CALL_LEVELS[site]).toBeDefined();
    }
  });

  it('should only have signal-noise as static', () => {
    const staticSites = Object.entries(CALL_LEVELS)
      .filter(([, level]) => level === 'static')
      .map(([site]) => site);
    expect(staticSites).toEqual(['signal-noise']);
  });

  it('should have correct dynamic sites', () => {
    const dynamicSites = Object.entries(CALL_LEVELS)
      .filter(([, level]) => level === 'dynamic')
      .map(([site]) => site)
      .sort();
    expect(dynamicSites).toEqual([
      'format-validate',
      'session-analyze',
      'task-extract',
      'verify-output',
      'verify-progress',
    ]);
  });
});
