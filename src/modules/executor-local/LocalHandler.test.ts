import { describe, it, expect, vi } from 'vitest';
import { LocalHandler } from './LocalHandler';
import { RequestContext } from '../../core/types';

const ctx: RequestContext = {
  taskId: 'test-task',
  repoUrl: 'owner/repo',
  repoBranch: 'main',
  llmCall: vi.fn(),
  moduleConfig: {},
};

const handler = new LocalHandler();

describe('LocalHandler', () => {
  it('routes executor-local.execute', async () => {
    const result = await handler.handleRequest('executor-local.execute', ['print("hi")'], ctx);
    expect(result.status).toBe('success');
    expect(result.message).toBe('Code executed locally.');
  });

  it('accepts object-form args', async () => {
    const result = await handler.handleRequest('executor-local.execute', [{ code: 'print("hi")' }], ctx);
    expect(result.status).toBe('success');
  });

  it('accepts empty args', async () => {
    const result = await handler.handleRequest('executor-local.execute', [], ctx);
    expect(result.status).toBe('success');
  });

  it('throws on unknown tool', async () => {
    await expect(handler.handleRequest('executor-local.unknown', [], ctx))
      .rejects.toThrow('Unknown tool: executor-local.unknown');
  });

  it('always returns the same placeholder response', async () => {
    const a = await handler.handleRequest('executor-local.execute', ['anything'], ctx);
    const b = await handler.handleRequest('executor-local.execute', [{ code: 'x' }], ctx);
    expect(a).toEqual(b);
  });
});
