import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RequestContext } from '../../core/types';

// Mock db before importing JulesHandler
vi.mock('../../services/db', () => ({
  db: {
    tasks: {
      get: vi.fn(),
    },
  },
}));

vi.mock('../../services/negotiators/JulesNegotiator', () => ({
  JulesNegotiator: {
    negotiate: vi.fn(() => Promise.resolve('jules result')),
  },
}));

import { JulesHandler } from './JulesHandler';
import { db } from '../../services/db';
import { JulesNegotiator } from '../../services/negotiators/JulesNegotiator';

const ctx: RequestContext = {
  taskId: 'task-1',
  repoUrl: 'owner/repo',
  repoBranch: 'main',
  llmCall: vi.fn(),
  moduleConfig: {},
};

const handler = new JulesHandler({ apiKey: 'test-key' });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('JulesHandler', () => {
  // ── routing ──

  it('throws on unknown tool', async () => {
    await expect(handler.handleRequest('executor-jules.unknown', [], ctx))
      .rejects.toThrow('Unknown tool: executor-jules.unknown');
  });

  // ── execute ──

  it('throws if task not found', async () => {
    (db.tasks.get as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    await expect(
      handler.handleRequest('executor-jules.execute', ['do stuff'], ctx),
    ).rejects.toThrow('Task not found: task-1');
  });

  it('executes with positional args', async () => {
    (db.tasks.get as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'task-1', title: 'Test' });
    const result = await handler.handleRequest(
      'executor-jules.execute',
      ['Fix the bug', 'Bug is fixed'],
      ctx,
    );
    expect(result).toBe('jules result');
    expect(JulesNegotiator.negotiate).toHaveBeenCalledWith(
      'test-key',
      { id: 'task-1', title: 'Test' },
      'owner/repo',
      'main',
      'Fix the bug',
      'Bug is fixed',
      ctx.llmCall,
    );
  });

  it('executes with object-form args', async () => {
    (db.tasks.get as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'task-1' });
    await handler.handleRequest(
      'executor-jules.execute',
      [{ prompt: 'Write tests', successCriteria: 'Tests pass' }],
      ctx,
    );
    expect(JulesNegotiator.negotiate).toHaveBeenCalledWith(
      'test-key',
      { id: 'task-1' },
      'owner/repo',
      'main',
      'Write tests',
      'Tests pass',
      ctx.llmCall,
    );
  });

  it('uses default successCriteria when not provided', async () => {
    (db.tasks.get as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'task-1' });
    await handler.handleRequest('executor-jules.execute', ['Do something'], ctx);
    expect(JulesNegotiator.negotiate).toHaveBeenCalledWith(
      'test-key',
      { id: 'task-1' },
      'owner/repo',
      'main',
      'Do something',
      'Task completed successfully',
      ctx.llmCall,
    );
  });
});
