import { describe, it, expect } from 'vitest';
import { GitFs } from './GitFs';

describe('GitFs', () => {
  describe('URL / owner parsing', () => {
    it('should parse sources/github/owner/repo format', () => {
      const fs = new GitFs('sources/github/myowner/myrepo', 'main', 'token');
      expect(fs.getDir()).toBe('/myowner/myrepo');
      expect(fs.getBranch()).toBe('main');
      expect(fs.getRepoUrl()).toBe('sources/github/myowner/myrepo');
    });

    it('should parse github.com URL with protocol', () => {
      const fs = new GitFs('https://github.com/owner/repo', 'develop', 'token');
      expect(fs.getDir()).toBe('/owner/repo');
    });

    it('should parse github.com URL without protocol', () => {
      const fs = new GitFs('github.com/user/project', 'main', 'token');
      expect(fs.getDir()).toBe('/user/project');
    });

    it('should parse plain owner/repo format', () => {
      const fs = new GitFs('foo/bar', 'main', 'token');
      expect(fs.getDir()).toBe('/foo/bar');
    });
  });

  describe('constructor defaults', () => {
    it('should default branch to main', () => {
      const fs = new GitFs('sources/github/o/r', undefined as any, 'token');
      expect(fs.getBranch()).toBe('main');
    });

    it('should expose getters', () => {
      const fs = new GitFs('sources/github/o/r', 'dev', 'my-token');
      expect(fs.getToken()).toBe('my-token');
      expect(fs.getRepoUrl()).toBe('sources/github/o/r');
    });
  });

  describe('taskDir static method', () => {
    it('should produce short-id task directory', () => {
      const dir = GitFs.taskDir('sources/github/o/r', '550e8400-e29b-41d4-a716-446655440000');
      expect(dir).toBe('/o/r--550e8400');
    });

    it('should handle short IDs without truncation', () => {
      const dir = GitFs.taskDir('sources/github/o/r', 'abc');
      expect(dir).toBe('/o/r--abc');
    });

    it('should work with github.com URLs', () => {
      const dir = GitFs.taskDir('https://github.com/owner/repo', 'deadbeef');
      expect(dir).toBe('/owner/repo--deadbeef');
    });
  });

  describe('taskDir constructor option', () => {
    it('should use provided taskDir instead of default', () => {
      const fs = new GitFs('sources/github/o/r', 'main', 'token', '/custom/dir');
      expect(fs.getDir()).toBe('/custom/dir');
    });
  });
});
