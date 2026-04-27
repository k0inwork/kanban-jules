import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadFixture } from './fixtureReplay';

// Mock dependencies before imports
vi.mock('../../lib/julesApi', () => ({
  julesApi: {
    createSession: vi.fn(),
    getSession: vi.fn(),
    listSessions: vi.fn(),
    sendMessage: vi.fn(),
    deleteSession: vi.fn(),
    approvePlan: vi.fn(),
    listActivities: vi.fn(),
  },
}));

vi.mock('../../services/db', () => ({
  db: {
    julesSessions: {
      where: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../../core/event-bus', () => ({
  eventBus: { emit: vi.fn() },
}));

import { JulesSessionManager } from './JulesSessionManager';
import { julesApi } from '../../lib/julesApi';
import { db } from '../../services/db';

const mockCreateSession = julesApi.createSession as ReturnType<typeof vi.fn>;
const mockGetSession = julesApi.getSession as ReturnType<typeof vi.fn>;
const mockListSessions = julesApi.listSessions as ReturnType<typeof vi.fn>;

function setupWhereChain(firstValue: any = undefined) {
  const first = vi.fn().mockResolvedValue(firstValue);
  const del = vi.fn().mockResolvedValue(undefined);
  const equals = vi.fn().mockReturnValue({ first, delete: del });
  const where = vi.fn().mockReturnValue({ equals });
  (db.julesSessions.where as ReturnType<typeof vi.fn>).mockImplementation(where);
  return { where, equals, first, delete: del };
}

describe('JulesSessionManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupWhereChain(undefined);
  });

  describe('findOrCreateSession', () => {
    it('creates new session with fixture-shaped response', async () => {
      const fixture = loadFixture('simple-task');
      const sessionShape = fixture.session;

      mockCreateSession.mockResolvedValue(sessionShape);
      mockGetSession.mockResolvedValue({ ...sessionShape, state: 'IN_PROGRESS' });

      const result = await JulesSessionManager.findOrCreateSession(
        'api-key', { id: 'task-1', title: 'Test Task', description: 'Do something' }, 'k0inwork/kanban-jules', 'main', 'sources/github/k0inwork/kanban-jules',
      );

      expect(result).toBeTruthy();
      expect(result!.name).toBe(sessionShape.name);
      expect(mockCreateSession).toHaveBeenCalledWith('api-key', expect.objectContaining({
        title: 'Test Task',
        sourceContext: {
          source: 'sources/github/k0inwork/kanban-jules',
          githubRepoContext: { startingBranch: 'main' },
        },
        requirePlanApproval: true,
      }));
      expect(db.julesSessions.put).toHaveBeenCalledWith(expect.objectContaining({
        name: sessionShape.name,
      }));
    });

    it('creates session without sourceContext when sourceName is empty', async () => {
      mockCreateSession.mockResolvedValue({ name: 'sessions/new-456', state: 'IN_PROGRESS' });
      mockGetSession.mockResolvedValue({ name: 'sessions/new-456', state: 'IN_PROGRESS' });

      await JulesSessionManager.findOrCreateSession(
        'api-key', { id: 'task-1', title: 'Test' }, 'owner/repo', 'main', '',
      );

      expect(mockCreateSession).toHaveBeenCalledWith('api-key', expect.objectContaining({
        sourceContext: undefined,
      }));
    });

    it('emits event on session creation', async () => {
      mockCreateSession.mockResolvedValue({ name: 'sessions/evt-123', state: 'IN_PROGRESS' });
      mockGetSession.mockResolvedValue({ name: 'sessions/evt-123', state: 'IN_PROGRESS' });

      await JulesSessionManager.findOrCreateSession(
        'api-key', { id: 'task-1', title: 'Test' }, 'owner/repo', 'main', 'sources/github/owner/repo',
      );

      const { eventBus } = await import('../../core/event-bus');
      expect(eventBus.emit).toHaveBeenCalledWith('module:log', expect.objectContaining({
        taskId: 'task-1',
        moduleId: 'executor-jules',
      }));
    });
  });

  describe('createSession', () => {
    it('returns immediately when session is not QUEUED', async () => {
      mockCreateSession.mockResolvedValue({ name: 'sessions/direct-123', state: 'IN_PROGRESS' });
      mockGetSession.mockResolvedValue({ name: 'sessions/direct-123', state: 'IN_PROGRESS' });

      const result = await JulesSessionManager.createSession('api-key', { id: 'task-1', title: 'Test' }, {
        source: 'sources/github/owner/repo',
      });

      expect(result.state).toBe('IN_PROGRESS');
      expect(mockGetSession).toHaveBeenCalledTimes(1);
    });

    it('polls until session leaves QUEUED state', async () => {
      mockCreateSession.mockResolvedValue({ name: 'sessions/poll-123', state: 'QUEUED' });
      mockGetSession
        .mockResolvedValueOnce({ name: 'sessions/poll-123', state: 'QUEUED' })
        .mockResolvedValueOnce({ name: 'sessions/poll-123', state: 'IN_PROGRESS' });

      vi.useFakeTimers();
      const promise = JulesSessionManager.createSession('api-key', { id: 'task-1', title: 'Test' }, {
        source: 'sources/github/owner/repo',
      });
      await vi.advanceTimersByTimeAsync(2000);
      const result = await promise;
      vi.useRealTimers();

      expect(result.state).toBe('IN_PROGRESS');
      expect(mockGetSession).toHaveBeenCalledTimes(2);
    });

    it('falls back to no sourceContext on 404', async () => {
      const notFoundError = Object.assign(new Error('not found'), { status: 404 });
      mockCreateSession
        .mockRejectedValueOnce(notFoundError)
        .mockResolvedValueOnce({ name: 'sessions/fallback-123', state: 'IN_PROGRESS' });
      mockGetSession.mockResolvedValue({ name: 'sessions/fallback-123', state: 'IN_PROGRESS' });

      const result = await JulesSessionManager.createSession('api-key', { id: 'task-1', title: 'Test' }, {
        source: 'sources/github/nonexistent/repo',
      });

      expect(mockCreateSession).toHaveBeenCalledTimes(2);
      const secondCall = mockCreateSession.mock.calls[1][1] as any;
      expect(secondCall.sourceContext).toBeUndefined();
      expect(result.name).toBe('sessions/fallback-123');
    });
  });

  describe('sendMessage', () => {
    it('delegates to julesApi.sendMessage', async () => {
      (julesApi.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});

      await JulesSessionManager.sendMessage('api-key', 'sessions/123', 'Hello');

      expect(julesApi.sendMessage).toHaveBeenCalledWith('api-key', 'sessions/123', 'Hello');
    });
  });

  describe('findExistingSession', () => {
    it('returns first non-FAILED session', async () => {
      mockListSessions.mockResolvedValue({
        sessions: [
          { name: 'sessions/failed', state: 'FAILED' },
          { name: 'sessions/active', state: 'IN_PROGRESS' },
        ],
      });

      const result = await JulesSessionManager.findExistingSession('api-key', 'owner/repo', 'main');
      expect(result).toEqual({ name: 'sessions/active', state: 'IN_PROGRESS' });
    });

    it('returns null when all sessions are FAILED', async () => {
      mockListSessions.mockResolvedValue({
        sessions: [{ name: 'sessions/f1', state: 'FAILED' }],
      });

      const result = await JulesSessionManager.findExistingSession('api-key', 'owner/repo', 'main');
      expect(result).toBeNull();
    });

    it('returns null when no sessions exist', async () => {
      mockListSessions.mockResolvedValue({ sessions: [] });

      const result = await JulesSessionManager.findExistingSession('api-key', 'owner/repo', 'main');
      expect(result).toBeNull();
    });
  });

  describe('deleteLocalSession', () => {
    it('deletes from db', async () => {
      await JulesSessionManager.deleteLocalSession('session-123');
      expect(db.julesSessions.delete).toHaveBeenCalledWith('session-123');
    });
  });
});
