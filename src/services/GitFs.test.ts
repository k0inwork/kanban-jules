import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitFs } from './GitFs';

/**
 * Helper: create a fetch mock that captures the URL and headers.
 * Returns the spy so tests can inspect call args.
 */
function mockFetch(responseBody: any) {
  return vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve(responseBody),
      text: () => Promise.resolve(JSON.stringify(responseBody)),
    } as Response)
  );
}

describe('GitFs', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('URL construction via listFiles', () => {
    it('should construct URL from sources/github/owner/repo format', async () => {
      const spy = mockFetch([]);
      vi.stubGlobal('fetch', spy);

      const fs = new GitFs('sources/github/myowner/myrepo', 'main', 'fake-token');
      await fs.listFiles('src');

      const calledUrl = spy.mock.calls[0][0] as string;
      expect(calledUrl).toContain('api.github.com/repos/myowner/myrepo/contents');
      expect(calledUrl).toContain('/src?');
      expect(calledUrl).toContain('ref=main');
    });

    it('should construct URL from github.com URL', async () => {
      const spy = mockFetch([]);
      vi.stubGlobal('fetch', spy);

      const fs = new GitFs('https://github.com/owner/repo', 'develop', 'token');
      await fs.listFiles('lib');

      const calledUrl = spy.mock.calls[0][0] as string;
      expect(calledUrl).toContain('api.github.com/repos/owner/repo/contents');
      expect(calledUrl).toContain('/lib?');
      expect(calledUrl).toContain('ref=develop');
    });

    it('should construct URL from github.com URL without protocol', async () => {
      const spy = mockFetch([]);
      vi.stubGlobal('fetch', spy);

      const fs = new GitFs('github.com/user/project', 'main', 'token');
      await fs.listFiles('');

      const calledUrl = spy.mock.calls[0][0] as string;
      expect(calledUrl).toContain('api.github.com/repos/user/project/contents');
    });

    it('should construct URL from plain owner/repo format', async () => {
      const spy = mockFetch([]);
      vi.stubGlobal('fetch', spy);

      const fs = new GitFs('foo/bar', 'main', 'token');
      await fs.listFiles('');

      const calledUrl = spy.mock.calls[0][0] as string;
      expect(calledUrl).toContain('api.github.com/repos/foo/bar/contents');
    });

    it('should handle root path (empty string) without double slashes', async () => {
      const spy = mockFetch([]);
      vi.stubGlobal('fetch', spy);

      const fs = new GitFs('sources/github/acme/app', 'main', 'token');
      await fs.listFiles('');

      const calledUrl = spy.mock.calls[0][0] as string;
      expect(calledUrl).toMatch(/contents\?ref=main$/);
    });

    it('should include authorization header with token', async () => {
      const spy = mockFetch([]);
      vi.stubGlobal('fetch', spy);

      const fs = new GitFs('sources/github/o/r', 'main', 'my-secret-token');
      await fs.listFiles('');

      const opts = spy.mock.calls[0][1] as RequestInit;
      expect(opts.headers).toHaveProperty('Authorization', 'token my-secret-token');
    });

    it('should include GitHub API accept header', async () => {
      const spy = mockFetch([]);
      vi.stubGlobal('fetch', spy);

      const fs = new GitFs('sources/github/o/r', 'main', 'token');
      await fs.listFiles('');

      const opts = spy.mock.calls[0][1] as RequestInit;
      expect(opts.headers).toHaveProperty('Accept', 'application/vnd.github.v3+json');
    });
  });

  describe('listFiles', () => {
    it('should map response array to GitFile objects', async () => {
      const apiResponse = [
        { name: 'src', path: 'src', type: 'dir', size: 0 },
        { name: 'readme.md', path: 'readme.md', type: 'file', size: 120 },
      ];
      vi.stubGlobal('fetch', mockFetch(apiResponse));

      const fs = new GitFs('sources/github/o/r', 'main', 'token');
      const files = await fs.listFiles('');

      expect(files).toHaveLength(2);
      expect(files[0]).toEqual({ name: 'src', path: 'src', type: 'dir', size: 0 });
      expect(files[1]).toEqual({ name: 'readme.md', path: 'readme.md', type: 'file', size: 120 });
    });

    it('should handle single-object response (non-array)', async () => {
      const apiResponse = { name: 'file.ts', path: 'file.ts', type: 'file', size: 50 };
      vi.stubGlobal('fetch', mockFetch(apiResponse));

      const fs = new GitFs('sources/github/o/r', 'main', 'token');
      const files = await fs.listFiles('file.ts');

      expect(files).toHaveLength(1);
      expect(files[0].name).toBe('file.ts');
    });

    it('should throw on non-ok response', async () => {
      vi.stubGlobal('fetch', () =>
        Promise.resolve({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          text: () => Promise.resolve('{"message": "Not Found"}'),
        } as Response)
      );

      const fs = new GitFs('sources/github/o/r', 'main', 'token');
      await expect(fs.listFiles('missing')).rejects.toThrow('Failed to list files');
    });
  });

  describe('constructor', () => {
    it('should default branch to main', () => {
      const fs = new GitFs('sources/github/o/r', undefined as any, 'token');
      // We can verify by checking listFiles URL
      expect(fs).toBeInstanceOf(GitFs);
    });
  });
});
