import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadFixture, adjustTimestamps } from './fixtureReplay';

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

  // ── Unit tests (hand-crafted mocks) ──

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

  // ── Fixture-driven tests ──

  it('replays simple-task fixture: plan → approve → complete', async () => {
    const fixture = loadFixture('simple-task');
    const activities = adjustTimestamps(fixture.allActivities);
    const sessionName = fixture.session.name;
    const states = fixture.stateTransitions.map(s => s.state);
    const sessionStates = [...states];
    if (!sessionStates.includes('COMPLETED')) sessionStates.push('COMPLETED');

    mockFindOrCreate.mockResolvedValue({ name: sessionName, state: 'IN_PROGRESS' });

    let stateIdx = 0;
    mockGetSession.mockImplementation(() => {
      const state = stateIdx < sessionStates.length ? sessionStates[stateIdx] : 'COMPLETED';
      stateIdx++;
      return Promise.resolve({ name: sessionName, state });
    });

    // All activities available from first poll (far-future timestamps all pass filter)
    mockListActivities.mockResolvedValue({ activities });

    // Progress verification returns false, final verification returns true
    mockLlmCall.mockImplementation((prompt: string) => {
      if (prompt.includes('Does this progress update')) return Promise.resolve('false');
      return Promise.resolve('true');
    });

    const promise = JulesNegotiator.negotiate(
      'key', mockTask, fixture.repo, fixture.branch,
      fixture.prompt, fixture.successCriteria, mockLlmCall,
    );
    promise.catch(() => {});

    for (let i = 0; i < 20; i++) {
      await tick();
    }

    const result = await promise;

    // Verify plan was auto-approved
    expect(mockApprovePlan).toHaveBeenCalledWith('key', sessionName);
    // Verify prompt was sent
    expect(mockSendMessage).toHaveBeenCalledWith('key', sessionName, expect.stringContaining(fixture.prompt));
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('replays ambiguous fixture: plan → approve → FAILED', async () => {
    const fixture = loadFixture('ambiguous');
    const sessionName = fixture.session.name;
    const states = fixture.stateTransitions.map(s => s.state);

    mockFindOrCreate.mockResolvedValue({ name: sessionName, state: 'IN_PROGRESS' });

    // Timestamps relative to fake timer start
    const activities = fixture.allActivities.map((a, i) => ({
      ...a,
      createTime: new Date(1000 + i * 10000).toISOString(),
    }));

    let activityIdx = 0;
    let stateIdx = 0;

    mockListActivities.mockImplementation(() => {
      activityIdx = Math.min(activityIdx + 2, activities.length);
      return Promise.resolve({ activities: activities.slice(0, activityIdx) });
    });

    mockGetSession.mockImplementation(() => {
      const state = stateIdx < states.length ? states[stateIdx] : 'FAILED';
      stateIdx++;
      return Promise.resolve({ name: sessionName, state });
    });

    // LLM returns false for progress verification so we keep polling until sessionFailed
    mockLlmCall.mockResolvedValue('false');

    const promise = JulesNegotiator.negotiate(
      'key', mockTask, fixture.repo, fixture.branch,
      fixture.prompt, fixture.successCriteria, mockLlmCall,
    );

    const catchPromise = promise.catch(e => e);

    for (let i = 0; i < 30; i++) {
      await tick();
    }

    const error = await catchPromise;
    // The fixture ended in FAILED state with sessionFailed activity containing reason
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/Jules session failed/i);
  });

  // ── Retained unit tests for edge cases not covered by fixtures ──

  it('sends prompt to session and returns agent message on completion (unit)', async () => {
    const agentActivity = {
      name: 'sessions/123/activities/agent1',
      id: 'agent1',
      createTime: '2099-06-01T00:00:00.000Z',
      originator: 'agent',
      agentMessaged: { agentMessage: 'Created hello.txt successfully' },
    };

    mockListActivities.mockResolvedValue({ activities: [agentActivity] });
    mockGetSession
      .mockResolvedValueOnce({ name: 'sessions/123', state: 'IN_PROGRESS' })
      .mockResolvedValueOnce({ name: 'sessions/123', state: 'COMPLETED' });

    const promise = JulesNegotiator.negotiate(
      'key', mockTask, 'owner/repo', 'main',
      'Create hello.txt', 'File exists', mockLlmCall,
    );
    promise.catch(() => {});
    await tick();
    const result = await promise;

    expect(result).toContain('Created hello.txt');
    expect(mockSendMessage).toHaveBeenCalledWith('key', 'sessions/123', expect.stringContaining('Create hello.txt'));
    expect(mockLlmCall).toHaveBeenCalled();
  });

  it('auto-approves plan when planGenerated activity received (unit)', async () => {
    const planActivity = {
      name: 'sessions/123/activities/plan1',
      id: 'plan1',
      createTime: '2099-06-01T00:00:00.000Z',
      originator: 'agent',
      planGenerated: {
        plan: { id: 'plan-1', steps: [{ id: 's1', title: 'Step 1' }], createTime: '2099-01-01T00:00:00Z' },
      },
    };
    const agentActivity = {
      name: 'sessions/123/activities/agent1',
      id: 'agent1',
      createTime: '2099-06-01T00:00:10.000Z',
      originator: 'agent',
      agentMessaged: { agentMessage: 'Done after plan' },
    };

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
      return Promise.resolve({ name: 'sessions/123', state: 'COMPLETED' });
    });

    const promise = JulesNegotiator.negotiate(
      'key', mockTask, 'owner/repo', 'main',
      'Do thing', 'Thing done', mockLlmCall,
    );
    promise.catch(() => {});

    await tick();
    await tick();

    const result = await promise;
    expect(mockApprovePlan).toHaveBeenCalledWith('key', 'sessions/123');
    expect(result).toContain('Done after plan');
  });

  it('retries when LLM verification fails then succeeds (unit)', async () => {
    const agentActivity1 = {
      name: 'sessions/123/activities/act1',
      id: 'act-1',
      createTime: '2099-06-01T00:00:00.000Z',
      originator: 'agent',
      agentMessaged: { agentMessage: 'Partial result' },
    };
    const agentActivity2 = {
      name: 'sessions/123/activities/act2',
      id: 'act-2',
      createTime: '2099-06-01T00:01:00.000Z',
      originator: 'agent',
      agentMessaged: { agentMessage: 'Complete result' },
    };

    let pollCount = 0;
    mockListActivities.mockImplementation(() => {
      pollCount++;
      if (pollCount === 1) return Promise.resolve({ activities: [agentActivity1] });
      return Promise.resolve({ activities: [agentActivity1, agentActivity2] });
    });

    let getSessionCount = 0;
    mockGetSession.mockImplementation(() => {
      getSessionCount++;
      if (getSessionCount <= 2) return Promise.resolve({ name: 'sessions/123', state: 'IN_PROGRESS' });
      if (getSessionCount === 3) return Promise.resolve({ name: 'sessions/123', state: 'COMPLETED' });
      return Promise.resolve({ name: 'sessions/123', state: 'COMPLETED', outputs: [] });
    });

    mockLlmCall
      .mockResolvedValueOnce('false')
      .mockResolvedValueOnce('true');

    const promise = JulesNegotiator.negotiate(
      'key', mockTask, 'owner/repo', 'main',
      'Do thing', 'Thing done', mockLlmCall,
    );
    promise.catch(() => {});

    await tick();
    await tick();

    const result = await promise;
    expect(result).toContain('Complete result');
  }, 30000);

  it('throws after max verification attempts (unit)', async () => {
    let actCount = 0;
    mockListActivities.mockImplementation(() => {
      actCount++;
      const activity = {
        name: `sessions/123/activities/bad-${actCount}`,
        id: `act-bad-${actCount}`,
        createTime: new Date(new Date('2099-06-01T00:00:00.000Z').getTime() + actCount * 60000).toISOString(),
        originator: 'agent',
        agentMessaged: { agentMessage: 'Bad result' },
      };
      return Promise.resolve({ activities: [activity] });
    });

    let getSessionCount = 0;
    mockGetSession.mockImplementation(() => {
      getSessionCount++;
      if (getSessionCount <= 6) return Promise.resolve({ name: 'sessions/123', state: 'IN_PROGRESS' });
      return Promise.resolve({ name: 'sessions/123', state: 'COMPLETED' });
    });

    mockLlmCall.mockResolvedValue('false');

    const promise = JulesNegotiator.negotiate(
      'key', mockTask, 'owner/repo', 'main',
      'Do thing', 'Thing done', mockLlmCall,
    );

    const catchPromise = promise.catch(e => e);

    for (let i = 0; i < 8; i++) {
      await tick();
    }

    const error = await catchPromise;
    expect(error.message).toContain('failed to meet success criteria');
  }, 30000);
});
