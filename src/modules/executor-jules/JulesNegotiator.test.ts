import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before imports
vi.mock('./JulesSessionManager', () => ({
  JulesSessionManager: {
    findOrCreateSession: vi.fn(),
    sendMessage: vi.fn(),
  },
}));

vi.mock('../../lib/julesApi', () => ({
  julesApi: {
    getSession: vi.fn(),
    listActivities: vi.fn(),
    approvePlan: vi.fn(),
    deleteSession: vi.fn(),
  },
}));

vi.mock('../../services/db', () => ({
  db: {
    julesSessions: {
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockReturnValue({ delete: vi.fn().mockResolvedValue(undefined) }),
      }),
    },
  },
}));

vi.mock('../../core/event-bus', () => ({
  eventBus: { emit: vi.fn() },
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(),
}));

// Mock global fetch for postCapture
globalThis.fetch = vi.fn().mockResolvedValue({ ok: true }) as any;

import { JulesNegotiator } from '../../services/negotiators/JulesNegotiator';
import { JulesSessionManager } from './JulesSessionManager';
import { julesApi } from '../../lib/julesApi';

const mockFindOrCreate = JulesSessionManager.findOrCreateSession as ReturnType<typeof vi.fn>;
const mockSendMessage = JulesSessionManager.sendMessage as ReturnType<typeof vi.fn>;
const mockGetSession = julesApi.getSession as ReturnType<typeof vi.fn>;
const mockListActivities = julesApi.listActivities as ReturnType<typeof vi.fn>;
const mockApprovePlan = julesApi.approvePlan as ReturnType<typeof vi.fn>;

const mockTask = { id: 'task-1', title: 'Test Task', description: 'Do the thing' };
const mockLlmCall = vi.fn();

// Use a far-future timestamp so the negotiator's latestActivityTimestamp filter
// always picks up our mock activities
const ACTIVITY_TIME = '2099-06-01T00:00:00.000Z';

function makeActivity(overrides: Record<string, any>) {
  return {
    name: `sessions/123/activities/${Math.random().toString(36).slice(2)}`,
    id: Math.random().toString(36).slice(2),
    createTime: ACTIVITY_TIME,
    originator: 'agent',
    ...overrides,
  };
}

/**
 * Advance fake timers and flush all microtasks.
 * The negotiator uses 5s polling intervals with `await new Promise(r => setTimeout(r, 5000))`.
 */
async function tick(ms = 6000) {
  await vi.advanceTimersByTimeAsync(ms);
}

describe('JulesNegotiator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockFindOrCreate.mockResolvedValue({ name: 'sessions/123', state: 'IN_PROGRESS' });
    mockSendMessage.mockResolvedValue(undefined);
    mockGetSession.mockResolvedValue({ name: 'sessions/123', state: 'IN_PROGRESS' });
    mockListActivities.mockResolvedValue({ activities: [] });
    mockLlmCall.mockResolvedValue('true');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('throws if no API key', async () => {
    await expect(
      JulesNegotiator.negotiate('', mockTask, 'owner/repo', 'main', 'prompt', 'criteria', mockLlmCall),
    ).rejects.toThrow('Jules API Key is not configured');
  });

  it('throws if session creation returns null', async () => {
    mockFindOrCreate.mockResolvedValue(null);

    await expect(
      JulesNegotiator.negotiate('key', mockTask, 'owner/repo', 'main', 'prompt', 'criteria', mockLlmCall),
    ).rejects.toThrow('Failed to create Jules session');
  });

  it('sends prompt to session and returns agent message on completion', async () => {
    const agentActivity = makeActivity({
      agentMessaged: { agentMessage: 'Created hello.txt successfully' },
    });

    mockListActivities.mockResolvedValue({ activities: [agentActivity] });
    mockGetSession
      .mockResolvedValueOnce({ name: 'sessions/123', state: 'IN_PROGRESS' })
      .mockResolvedValueOnce({ name: 'sessions/123', state: 'COMPLETED' });

    const promise = JulesNegotiator.negotiate(
      'key', mockTask, 'owner/repo', 'main',
      'Create hello.txt', 'File exists', mockLlmCall,
    );

    // Attach catch handler early to prevent unhandled rejection
    promise.catch(() => {});
    await tick();
    const result = await promise;

    expect(result).toContain('Created hello.txt');
    expect(mockSendMessage).toHaveBeenCalledWith('key', 'sessions/123', expect.stringContaining('Create hello.txt'));
    expect(mockLlmCall).toHaveBeenCalled();
  });

  it('auto-approves plan when planGenerated activity received', async () => {
    const planActivity = makeActivity({
      planGenerated: {
        plan: { id: 'plan-1', steps: [{ id: 's1', title: 'Step 1' }], createTime: '2099-01-01T00:00:00Z' },
      },
    });
    const agentActivity = makeActivity({
      agentMessaged: { agentMessage: 'Done after plan' },
      id: 'agent-after-plan',
      createTime: '2099-06-01T00:01:00.000Z',
    });

    let pollCount = 0;
    mockListActivities.mockImplementation(() => {
      pollCount++;
      if (pollCount === 1) return Promise.resolve({ activities: [planActivity] });
      return Promise.resolve({ activities: [planActivity, agentActivity] });
    });

    let getSessionCount = 0;
    mockGetSession.mockImplementation(() => {
      getSessionCount++;
      if (getSessionCount === 1) return Promise.resolve({ name: 'sessions/123', state: 'AWAITING_PLAN_APPROVAL' });
      if (getSessionCount === 2) return Promise.resolve({ name: 'sessions/123', state: 'IN_PROGRESS' });
      if (getSessionCount === 3) return Promise.resolve({ name: 'sessions/123', state: 'COMPLETED' });
      return Promise.resolve({ name: 'sessions/123', state: 'COMPLETED', outputs: [] });
    });

    const promise = JulesNegotiator.negotiate(
      'key', mockTask, 'owner/repo', 'main',
      'Do thing', 'Thing done', mockLlmCall,
    );
    promise.catch(() => {});

    // First poll: plan generated + approved
    await tick();
    // Second poll: agent message arrives
    await tick();

    const result = await promise;
    expect(mockApprovePlan).toHaveBeenCalledWith('key', 'sessions/123');
    expect(result).toContain('Done after plan');
  });

  it('throws on FAILED session state', async () => {
    mockGetSession.mockResolvedValue({ name: 'sessions/123', state: 'FAILED' });

    const promise = JulesNegotiator.negotiate(
      'key', mockTask, 'owner/repo', 'main',
      'Do thing', 'Thing done', mockLlmCall,
    );

    // Prevent unhandled rejection — attach catch before advancing timers
    const catchPromise = promise.catch(e => e);

    await tick();

    const error = await catchPromise;
    expect(error.message).toContain('Jules session failed');
  });

  it('throws on sessionFailed activity', async () => {
    const failedActivity = makeActivity({
      sessionFailed: { reason: 'Something went wrong' },
    });
    mockListActivities.mockResolvedValue({ activities: [failedActivity] });
    mockGetSession.mockResolvedValue({ name: 'sessions/123', state: 'FAILED' });

    const promise = JulesNegotiator.negotiate(
      'key', mockTask, 'owner/repo', 'main',
      'Do thing', 'Thing done', mockLlmCall,
    );

    const catchPromise = promise.catch(e => e);

    await tick();

    const error = await catchPromise;
    expect(error.message).toContain('Something went wrong');
  });

  it('retries when LLM verification fails then succeeds', async () => {
    const agentActivity = makeActivity({
      agentMessaged: { agentMessage: 'Partial result' },
      id: 'act-1',
    });
    const agentActivity2 = makeActivity({
      agentMessaged: { agentMessage: 'Complete result' },
      id: 'act-2',
      createTime: '2099-06-01T00:01:00.000Z',
    });

    let pollCount = 0;
    mockListActivities.mockImplementation(() => {
      pollCount++;
      if (pollCount === 1) return Promise.resolve({ activities: [agentActivity] });
      return Promise.resolve({ activities: [agentActivity, agentActivity2] });
    });

    let getSessionCount = 0;
    mockGetSession.mockImplementation(() => {
      getSessionCount++;
      if (getSessionCount <= 2) return Promise.resolve({ name: 'sessions/123', state: 'IN_PROGRESS' });
      if (getSessionCount === 3) return Promise.resolve({ name: 'sessions/123', state: 'COMPLETED' });
      return Promise.resolve({ name: 'sessions/123', state: 'COMPLETED', outputs: [] });
    });

    // First verification fails, second succeeds
    mockLlmCall
      .mockResolvedValueOnce('false')
      .mockResolvedValueOnce('true');

    const promise = JulesNegotiator.negotiate(
      'key', mockTask, 'owner/repo', 'main',
      'Do thing', 'Thing done', mockLlmCall,
    );
    promise.catch(() => {});

    // First poll: agent message, verification fails
    await tick();
    // Second poll: retry agent message, verification succeeds
    await tick();

    const result = await promise;
    expect(result).toContain('Complete result');
  }, 30000);

  it('throws after max verification attempts', async () => {
    // Use unique timestamps per poll so the negotiator sees "new" activities each time
    let actCount = 0;
    mockListActivities.mockImplementation(() => {
      actCount++;
      const activity = makeActivity({
        agentMessaged: { agentMessage: 'Bad result' },
        id: `act-bad-${actCount}`,
        createTime: new Date(Date.parse(ACTIVITY_TIME) + actCount * 60000).toISOString(),
      });
      return Promise.resolve({ activities: [activity] });
    });

    let getSessionCount = 0;
    mockGetSession.mockImplementation(() => {
      getSessionCount++;
      if (getSessionCount <= 6) return Promise.resolve({ name: 'sessions/123', state: 'IN_PROGRESS' });
      return Promise.resolve({ name: 'sessions/123', state: 'COMPLETED' });
    });

    // Verification always fails
    mockLlmCall.mockResolvedValue('false');

    const promise = JulesNegotiator.negotiate(
      'key', mockTask, 'owner/repo', 'main',
      'Do thing', 'Thing done', mockLlmCall,
    );

    const catchPromise = promise.catch(e => e);

    // 3 attempts × 2 polls each (agent message + verification loop)
    for (let i = 0; i < 8; i++) {
      await tick();
    }

    const error = await catchPromise;
    expect(error.message).toContain('failed to meet success criteria');
  }, 30000);
});
