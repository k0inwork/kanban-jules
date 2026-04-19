import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RequestContext } from '../../core/types';

// Mock the negotiator before importing UserHandler
vi.mock('../../services/negotiators/UserNegotiator', () => ({
  UserNegotiator: {
    negotiate: vi.fn(() => Promise.resolve('user answer')),
    sendMessage: vi.fn(() => Promise.resolve()),
  },
}));

import { UserHandler } from './UserHandler';
import { UserNegotiator } from '../../services/negotiators/UserNegotiator';

const ctx: RequestContext = {
  taskId: 't1',
  repoUrl: 'owner/repo',
  repoBranch: 'main',
  llmCall: vi.fn(),
  moduleConfig: {},
};

const handler = new UserHandler();

beforeEach(() => {
  vi.clearAllMocks();
});

describe('UserHandler', () => {
  // ── routing ──

  it('throws on unknown tool', async () => {
    await expect(handler.handleRequest('channel-user-negotiator.unknown', [], ctx))
      .rejects.toThrow('Unknown tool: channel-user-negotiator.unknown');
  });

  // ── askUser ──

  it('asks user with positional args', async () => {
    const result = await handler.handleRequest(
      'channel-user-negotiator.askUser',
      ['What should I do?', 'text'],
      ctx,
    );
    expect(result).toBe('user answer');
    expect(UserNegotiator.negotiate).toHaveBeenCalledWith('t1', 'What should I do?', 'text', ctx.llmCall);
  });

  it('asks user with object-form args', async () => {
    const result = await handler.handleRequest(
      'channel-user-negotiator.askUser',
      [{ question: 'Pick one', format: 'json' }],
      ctx,
    );
    expect(result).toBe('user answer');
    expect(UserNegotiator.negotiate).toHaveBeenCalledWith('t1', 'Pick one', 'json', ctx.llmCall);
  });

  it('asks user without format', async () => {
    await handler.handleRequest('channel-user-negotiator.askUser', ['Yes or no?'], ctx);
    expect(UserNegotiator.negotiate).toHaveBeenCalledWith('t1', 'Yes or no?', undefined, ctx.llmCall);
  });

  // ── sendUser ──

  it('sends message with positional arg', async () => {
    await handler.handleRequest('channel-user-negotiator.sendUser', ['Status update'], ctx);
    expect(UserNegotiator.sendMessage).toHaveBeenCalledWith('t1', 'Status update');
  });

  it('sends message with object-form arg', async () => {
    await handler.handleRequest(
      'channel-user-negotiator.sendUser',
      [{ message: 'Object form' }],
      ctx,
    );
    expect(UserNegotiator.sendMessage).toHaveBeenCalledWith('t1', 'Object form');
  });
});
