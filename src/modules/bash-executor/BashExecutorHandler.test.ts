import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BashExecutorHandler } from './BashExecutorHandler';

// Mock boardVM on globalThis
const mockBashExec = vi.fn();
const mockFsBridge = {
  exists: vi.fn(),
  rm: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
};

beforeEach(() => {
  (globalThis as any).boardVM = {
    bashExec: mockBashExec,
    fsBridge: mockFsBridge,
  };
  mockBashExec.mockReset();
  mockFsBridge.exists.mockReset();
  BashExecutorHandler['_config'] = null;
});

afterEach(() => {
  delete (globalThis as any).boardVM;
});

describe('BashExecutorHandler', () => {
  const handler = new BashExecutorHandler();

  describe('exec', () => {
    it('should execute a command with default cwd /home/project', async () => {
      mockBashExec.mockResolvedValue({
        stdout: 'hello world\n',
        exitCode: 0,
        durationMs: 100,
      });

      const result = await handler.handleRequest('bash-executor.exec', [{ command: 'echo hello world' }], makeContext());

      expect(mockBashExec).toHaveBeenCalledWith({
        command: 'echo hello world',
        cwd: '/tmp/test/repo',
        timeout: 30000,
      });
      expect(result).toEqual({
        stdout: 'hello world\n',
        exitCode: 0,
        durationMs: 100,
      });
    });

    it('should use provided cwd and timeout', async () => {
      mockBashExec.mockResolvedValue({ stdout: '', exitCode: 0, durationMs: 50 });

      await handler.handleRequest('bash-executor.exec', [{
        command: 'ls',
        cwd: '/tmp',
        timeout: 5000,
      }], makeContext());

      expect(mockBashExec).toHaveBeenCalledWith({
        command: 'ls',
        cwd: '/tmp',
        timeout: 5000,
      });
    });

    it('should cap timeout at 120000ms', async () => {
      mockBashExec.mockResolvedValue({ stdout: '', exitCode: 0, durationMs: 0 });

      await handler.handleRequest('bash-executor.exec', [{
        command: 'sleep 999',
        timeout: 999999,
      }], makeContext());

      expect(mockBashExec).toHaveBeenCalledWith(
        expect.objectContaining({ timeout: 120000 })
      );
    });

    it('should return error when no command provided', async () => {
      const result = await handler.handleRequest('bash-executor.exec', [{}], makeContext());

      expect(result).toEqual({
        stdout: '',
        exitCode: 1,
        error: 'command is required',
        durationMs: 0,
      });
    });

    it('should return error when boardVM.bashExec not available', async () => {
      delete (globalThis as any).boardVM;

      const result = await handler.handleRequest('bash-executor.exec', [{
        command: 'echo hi',
      }], makeContext());

      expect(result).toEqual({
        stdout: '',
        exitCode: 1,
        error: 'bashExec bridge not available',
        durationMs: 0,
      });
    });
  });

  describe('clone', () => {
    it('should copy /tmp/repo-root to /home/project', async () => {
      mockFsBridge.exists.mockResolvedValue(true);
      mockBashExec
        .mockResolvedValueOnce({ stdout: '', exitCode: 0, durationMs: 500 }) // cp -r
        .mockResolvedValueOnce({ stdout: 'abc123\n', exitCode: 0, durationMs: 50 }); // git rev-parse

      const result = await handler.handleRequest('bash-executor.clone', [{}], makeContext());

      expect(mockBashExec).toHaveBeenCalledTimes(2);
      expect(mockBashExec).toHaveBeenNthCalledWith(1, {
        command: 'mkdir -p /tmp/test && rm -rf /tmp/test/repo && cp -r /tmp/repo-root /tmp/test/repo',
        cwd: '/home',
        timeout: 60000,
      });
      expect(result).toEqual({
        path: '/tmp/test/repo',
        branch: 'main',
        commit: 'abc123',
      });
    });

    it('should return error when repo not yet cloned', async () => {
      mockFsBridge.exists.mockResolvedValue(false);

      const result = await handler.handleRequest('bash-executor.clone', [{}], makeContext());

      expect(result).toEqual({
        path: '',
        error: 'Repo not yet cloned (startup prefetch still running or failed)',
      });
    });

    it('should return error when boardVM not available', async () => {
      delete (globalThis as any).boardVM;

      const result = await handler.handleRequest('bash-executor.clone', [{}], makeContext());

      expect(result).toEqual({
        path: '',
        error: 'boardVM not available',
      });
    });
  });

  describe('init / prefetchRepo', () => {
    it('should skip prefetch when no repoUrl configured', () => {
      BashExecutorHandler.init({ repoUrl: '', repoBranch: 'main', githubToken: '' });
      // No bashExec calls should happen
      expect(mockBashExec).not.toHaveBeenCalled();
    });
  });
});

function makeContext() {
  return {
    taskId: 'test',
    repoUrl: 'https://github.com/example/repo.git',
    repoBranch: 'main',
    githubToken: 'test-token',
    llmCall: async () => '',
    moduleConfig: {},
  } as any;
}
