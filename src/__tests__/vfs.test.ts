/**
 * Tests for vfs.ts and RepositoryTool — hit IndexedDB directly, no v86/GitFs.
 *
 * Setup: fake-indexeddb/auto provides a full IDB polyfill in Node.
 * We seed IDB with records matching v86's idbfs format (flat paths, no vm/ prefix)
 * then test that vfs resolves paths correctly and reads/writes match.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { vfs } from '../services/vfs';

const DB_NAME = 'wanix-env';
const STORE = 'files';

/** Open the IDB directly and seed records */
function seedIDB(records: { path: string; data?: string | Uint8Array; isDir: boolean; mode: number; modTime: number }[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'path' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (const rec of records) {
        store.put(rec);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

beforeEach(async () => {
  await vfs.clear();
});

describe('vfs — resolvePath', () => {
  it('strips leading / to produce IDB key', async () => {
    expect(await vfs.resolvePath('/tmp/repo-root')).toBe('tmp/repo-root');
  });

  it('handles /tmp (no trailing content)', async () => {
    expect(await vfs.resolvePath('/tmp')).toBe('tmp');
  });

  it('handles /tmp/ with trailing slash', async () => {
    expect(await vfs.resolvePath('/tmp/')).toBe('tmp');
  });

  it('handles /home/X', async () => {
    expect(await vfs.resolvePath('/home/user/file.txt')).toBe('home/user/file.txt');
  });

  it('handles /workspace → "." (Yuan agent root)', async () => {
    // /workspace maps to v86 root, which is "." in fs.ValidPath
    expect(await vfs.resolvePath('/workspace')).toBe('.');
  });

  it('handles /workspace/X → "X" (Yuan path routed to v86)', async () => {
    expect(await vfs.resolvePath('/workspace/src/index.ts')).toBe('src/index.ts');
  });

  it('handles bare "/"', async () => {
    expect(await vfs.resolvePath('/')).toBe('.');
  });

  it('handles empty string', async () => {
    expect(await vfs.resolvePath('')).toBe('.');
  });
});

describe('vfs — readFile / writeFile', () => {
  beforeEach(async () => {
    await seedIDB([
      { path: 'tmp/repo-root/src/App.tsx', data: 'import React;', isDir: false, mode: 0o644, modTime: Date.now() },
    ]);
  });

  it('reads file from IDBFS overlay', async () => {
    const content = await vfs.readFile('/tmp/repo-root/src/App.tsx');
    expect(content).toBe('import React;');
  });

  it('writes file to IDBFS overlay and reads it back', async () => {
    await vfs.writeFile('/tmp/repo-root/src/new-file.ts', 'export const X = 1;');
    const content = await vfs.readFile('/tmp/repo-root/src/new-file.ts');
    expect(content).toBe('export const X = 1;');
  });
});

describe('vfs — stat', () => {
  beforeEach(async () => {
    await seedIDB([
      { path: 'tmp/repo-root/package.json', data: '{"name":"test"}', isDir: false, mode: 0o644, modTime: 1700000000000 },
      { path: 'tmp/repo-root/src', isDir: true, mode: 0o755, modTime: 1700000001000 },
    ]);
  });

  it('stat returns {exists, isDir, size, mode, mtime} for a file', async () => {
    const s = await vfs.stat('/tmp/repo-root/package.json');
    expect(s.exists).toBe(true);
    expect(s.isDir).toBe(false);
    expect(s.size).toBe(15); // '{"name":"test"}'
    expect(s.mode).toBe(0o644);
    expect(s.mtime).toBe(1700000000000);
  });

  it('stat returns isDir=true for a directory record', async () => {
    const s = await vfs.stat('/tmp/repo-root/src');
    expect(s.exists).toBe(true);
    expect(s.isDir).toBe(true);
    expect(s.size).toBe(0);
    expect(s.mode).toBe(0o755);
  });

  it('stat returns exists=false for unknown path', async () => {
    const s = await vfs.stat('/tmp/nonexistent');
    expect(s.exists).toBe(false);
    expect(s.isDir).toBe(false);
  });

  it('stat detects implicit directory from child keys', async () => {
    // No explicit record for /tmp/repo-root, but children exist
    const s = await vfs.stat('/tmp/repo-root');
    expect(s.exists).toBe(true);
    expect(s.isDir).toBe(true);
  });
});

describe('vfs — exists', () => {
  beforeEach(async () => {
    await seedIDB([
      { path: 'tmp/repo-root/README.md', data: '# Hello', isDir: false, mode: 0o644, modTime: Date.now() },
    ]);
  });

  it('returns true for existing file', async () => {
    expect(await vfs.exists('/tmp/repo-root/README.md')).toBe(true);
  });

  it('returns true for implicit directory', async () => {
    expect(await vfs.exists('/tmp/repo-root')).toBe(true);
  });

  it('returns false for nonexistent path', async () => {
    expect(await vfs.exists('/tmp/nope')).toBe(false);
  });
});

describe('vfs — mkdir / mkdirp', () => {
  it('mkdir creates a directory record', async () => {
    await vfs.mkdir('/tmp/new-dir');
    const s = await vfs.stat('/tmp/new-dir');
    expect(s.exists).toBe(true);
    expect(s.isDir).toBe(true);
    expect(s.mode).toBe(0o755);
  });

  it('mkdirp creates all intermediate directories', async () => {
    await vfs.mkdirp('/tmp/a/b/c');
    const sa = await vfs.stat('/tmp/a');
    expect(sa.exists).toBe(true);
    expect(sa.isDir).toBe(true);
    const sb = await vfs.stat('/tmp/a/b');
    expect(sb.exists).toBe(true);
    expect(sb.isDir).toBe(true);
    const sc = await vfs.stat('/tmp/a/b/c');
    expect(sc.exists).toBe(true);
    expect(sc.isDir).toBe(true);
  });
});

describe('vfs — readdir', () => {
  beforeEach(async () => {
    await seedIDB([
      { path: 'tmp/repo-root/src/App.tsx', data: 'a', isDir: false, mode: 0o644, modTime: Date.now() },
      { path: 'tmp/repo-root/src/index.ts', data: 'b', isDir: false, mode: 0o644, modTime: Date.now() },
      { path: 'tmp/repo-root/src/utils', isDir: true, mode: 0o755, modTime: Date.now() },
      { path: 'tmp/repo-root/package.json', data: 'c', isDir: false, mode: 0o644, modTime: Date.now() },
    ]);
  });

  it('lists direct children of a directory', async () => {
    const entries = await vfs.readdir('/tmp/repo-root');
    expect(entries).toContain('src');
    expect(entries).toContain('package.json');
    expect(entries).not.toContain('App.tsx'); // nested, not direct child
  });

  it('lists files inside subdirectory', async () => {
    const entries = await vfs.readdir('/tmp/repo-root/src');
    expect(entries).toContain('App.tsx');
    expect(entries).toContain('index.ts');
    expect(entries).toContain('utils');
  });
});

describe('vfs — unlink / rmrf', () => {
  beforeEach(async () => {
    await seedIDB([
      { path: 'tmp/repo-root/file1.txt', data: 'hello', isDir: false, mode: 0o644, modTime: Date.now() },
      { path: 'tmp/repo-root/file2.txt', data: 'world', isDir: false, mode: 0o644, modTime: Date.now() },
      { path: 'tmp/repo-root/src/App.tsx', data: 'a', isDir: false, mode: 0o644, modTime: Date.now() },
    ]);
  });

  it('unlink removes a single file', async () => {
    await vfs.unlink('/tmp/repo-root/file1.txt');
    expect(await vfs.exists('/tmp/repo-root/file1.txt')).toBe(false);
    expect(await vfs.exists('/tmp/repo-root/file2.txt')).toBe(true);
  });

  it('rmrf removes all entries under prefix', async () => {
    await vfs.rmrf('/tmp/repo-root/src');
    expect(await vfs.exists('/tmp/repo-root/src/App.tsx')).toBe(false);
    expect(await vfs.exists('/tmp/repo-root/file1.txt')).toBe(true);
  });
});

describe('vfs — clear', () => {
  it('clears all IDBFS records', async () => {
    await seedIDB([
      { path: 'tmp/repo-root/file.txt', data: 'x', isDir: false, mode: 0o644, modTime: Date.now() },
    ]);
    expect(await vfs.exists('/tmp/repo-root/file.txt')).toBe(true);
    await vfs.clear();
    expect(await vfs.exists('/tmp/repo-root/file.txt')).toBe(false);
  });
});

describe('vfs — headFile', () => {
  beforeEach(async () => {
    await seedIDB([
      { path: 'tmp/repo-root/multi.txt', data: 'line1\nline2\nline3\nline4\nline5', isDir: false, mode: 0o644, modTime: Date.now() },
    ]);
  });

  it('returns first 3 lines by default', async () => {
    const head = await vfs.headFile('/tmp/repo-root/multi.txt');
    expect(head).toBe('line1\nline2\nline3');
  });

  it('returns first N lines when specified', async () => {
    const head = await vfs.headFile('/tmp/repo-root/multi.txt', 2);
    expect(head).toBe('line1\nline2');
  });
});

// ── RepositoryTool integration tests ───────────────────────

import { RepositoryTool } from '../modules/knowledge-repo-browser/RepositoryTool';

describe('RepositoryTool — vfs-backed', () => {
  const fakeCtx = { taskId: 'test-task', repoUrl: 'owner/repo', repoBranch: 'main', githubToken: '' } as any;

  beforeEach(async () => {
    await seedIDB([
      { path: 'tmp/repo-root/package.json', data: '{"name":"test-repo"}', isDir: false, mode: 0o644, modTime: Date.now() },
      { path: 'tmp/repo-root/src/App.tsx', data: 'import React from "react";', isDir: false, mode: 0o644, modTime: Date.now() },
      { path: 'tmp/repo-root/src/index.ts', data: 'export { App } from "./App";', isDir: false, mode: 0o644, modTime: Date.now() },
      { path: 'tmp/repo-root/src/utils', isDir: true, mode: 0o755, modTime: Date.now() },
      { path: 'tmp/repo-root/README.md', data: '# Test Repo\nLine 2\nLine 3\nLine 4', isDir: false, mode: 0o644, modTime: Date.now() },
    ]);
  });

  it('listFiles returns directory entries', async () => {
    const files = await RepositoryTool.handleRequest(
      'knowledge-repo-browser.listFiles',
      [{ path: '' }],
      fakeCtx
    );
    expect(files).toContain('src');
    expect(files).toContain('package.json');
    expect(files).toContain('README.md');
  });

  it('listFiles works for subdirectory', async () => {
    const files = await RepositoryTool.handleRequest(
      'knowledge-repo-browser.listFiles',
      [{ path: 'src' }],
      fakeCtx
    );
    expect(files).toContain('App.tsx');
    expect(files).toContain('index.ts');
    expect(files).toContain('utils');
  });

  it('readFile returns file content', async () => {
    const content = await RepositoryTool.handleRequest(
      'knowledge-repo-browser.readFile',
      [{ path: 'package.json' }],
      fakeCtx
    );
    expect(content).toBe('{"name":"test-repo"}');
  });

  it('headFile returns first N lines', async () => {
    const head = await RepositoryTool.handleRequest(
      'knowledge-repo-browser.headFile',
      [{ path: 'README.md', lines: 2 }],
      fakeCtx
    );
    expect(head).toBe('# Test Repo\nLine 2');
  });

  it('writeFile writes content and it is readable', async () => {
    await RepositoryTool.handleRequest(
      'knowledge-repo-browser.writeFile',
      [{ path: 'new-file.ts', content: 'export const NEW = true;' }],
      fakeCtx
    );
    const content = await RepositoryTool.handleRequest(
      'knowledge-repo-browser.readFile',
      [{ path: 'new-file.ts' }],
      fakeCtx
    );
    expect(content).toBe('export const NEW = true;');
  });

  it('writeFile with taskDir writes to task-specific path', async () => {
    const taskCtx = { ...fakeCtx, taskDir: 'task-42' };
    await RepositoryTool.handleRequest(
      'knowledge-repo-browser.writeFile',
      [{ path: 'result.txt', content: 'task output' }],
      taskCtx
    );
    // Read back via vfs directly using the expected task path
    const content = await vfs.readFile('/tmp/task-42/repo/result.txt');
    expect(content).toBe('task output');
  });
});

// ── IDBFS passthrough / path correctness tests ────────────

describe('vfs — IDBFS record verification', () => {
  /** Read raw records directly from IDB */
  function readAllIDBRecords(): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'path' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(STORE, 'readonly');
        const store = tx.objectStore(STORE);
        const getAll = store.getAll();
        getAll.onsuccess = () => resolve(getAll.result);
        getAll.onerror = () => reject(getAll.error);
      };
      req.onerror = () => reject(req.error);
    });
  }

  it('writeFile stores record with correct flat path in IDB', async () => {
    await vfs.writeFile('/tmp/repo-root/src/new.ts', 'content');
    const records = await readAllIDBRecords();
    const match = records.find((r: any) => r.path === 'tmp/repo-root/src/new.ts');
    expect(match).toBeDefined();
    expect(match.data).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(match.data)).toBe('content');
    expect(match.isDir).toBe(false);
    expect(match.mode).toBe(0o644);
    expect(typeof match.modTime).toBe('number');
  });

  it('mkdir stores record with correct flat path in IDB', async () => {
    await vfs.mkdir('/tmp/repo-root/lib');
    const records = await readAllIDBRecords();
    const match = records.find((r: any) => r.path === 'tmp/repo-root/lib');
    expect(match).toBeDefined();
    expect(match.isDir).toBe(true);
    expect(match.mode).toBe(0o755);
  });

  it('mkdirp creates all intermediate records with correct paths', async () => {
    await vfs.mkdirp('/tmp/repo-root/a/b/c');
    const records = await readAllIDBRecords();
    const paths = records.map((r: any) => r.path);
    expect(paths).toContain('tmp/repo-root/a');
    expect(paths).toContain('tmp/repo-root/a/b');
    expect(paths).toContain('tmp/repo-root/a/b/c');
    // All are directories
    for (const p of ['tmp/repo-root/a', 'tmp/repo-root/a/b', 'tmp/repo-root/a/b/c']) {
      const rec = records.find((r: any) => r.path === p);
      expect(rec.isDir).toBe(true);
      expect(rec.mode).toBe(0o755);
    }
  });

  it('unlink removes the exact path from IDB', async () => {
    await vfs.writeFile('/tmp/repo-root/del.txt', 'bye');
    let records = await readAllIDBRecords();
    expect(records.some((r: any) => r.path === 'tmp/repo-root/del.txt')).toBe(true);
    await vfs.unlink('/tmp/repo-root/del.txt');
    records = await readAllIDBRecords();
    expect(records.some((r: any) => r.path === 'tmp/repo-root/del.txt')).toBe(false);
  });

  it('rmrf removes all records under prefix', async () => {
    await vfs.writeFile('/tmp/repo-root/keep.txt', 'keep');
    await vfs.writeFile('/tmp/repo-root/src/a.ts', 'a');
    await vfs.writeFile('/tmp/repo-root/src/b.ts', 'b');
    await vfs.rmrf('/tmp/repo-root/src');
    const records = await readAllIDBRecords();
    const paths = records.map((r: any) => r.path);
    expect(paths).not.toContain('tmp/repo-root/src/a.ts');
    expect(paths).not.toContain('tmp/repo-root/src/b.ts');
    expect(paths).toContain('tmp/repo-root/keep.txt');
  });

  it('readFile reads from correct flat path in IDB', async () => {
    const data = new TextEncoder().encode('tarfs content');
    await seedIDB([
      { path: 'tmp/repo-root/deep/nested/file.ts', data, isDir: false, mode: 0o644, modTime: 12345 },
    ]);
    const content = await vfs.readFile('/tmp/repo-root/deep/nested/file.ts');
    expect(content).toBe('tarfs content');
  });

  it('stat reads mode and mtime from correct IDB record', async () => {
    const mtime = 1700000005000;
    await seedIDB([
      { path: 'tmp/repo-root/config.json', data: '{}', isDir: false, mode: 0o600, modTime: mtime },
    ]);
    const s = await vfs.stat('/tmp/repo-root/config.json');
    expect(s.mode).toBe(0o600);
    expect(s.mtime).toBe(mtime);
  });

  it('readdir only lists direct children under prefix', async () => {
    await seedIDB([
      { path: 'tmp/repo-root/src/index.ts', data: '', isDir: false, mode: 0o644, modTime: Date.now() },
      { path: 'tmp/repo-root/src/utils/helpers.ts', data: '', isDir: false, mode: 0o644, modTime: Date.now() },
      { path: 'tmp/repo-root/src/utils', isDir: true, mode: 0o755, modTime: Date.now() },
    ]);
    const entries = await vfs.readdir('/tmp/repo-root/src');
    expect(entries).toEqual(['index.ts', 'utils']);
  });
});

// ── Fallback to fsBridge tests ───────────────────────────

describe('vfs — fallback to boardVM.fsBridge', () => {
  let bridgeCalls: { method: string; args: any[] }[] = [];

  beforeEach(() => {
    bridgeCalls = [];
    // Mock boardVM.fsBridge
    (globalThis as any).boardVM = {
      fsBridge: {
        readFile: async (path: string) => {
          bridgeCalls.push({ method: 'readFile', args: [path] });
          return 'content from tarfs base';
        },
        stat: async (path: string) => {
          bridgeCalls.push({ method: 'stat', args: [path] });
          if (path === '/tmp/repo-root/tarfs-only.txt') {
            return { exists: true, isDir: false, size: 42, mode: 0o644, mtime: 1700000000000 };
          }
          return { exists: false, isDir: false, size: 0, mode: 0, mtime: 0 };
        },
        exists: async (path: string) => {
          bridgeCalls.push({ method: 'exists', args: [path] });
          return path === '/tmp/repo-root/tarfs-dir';
        },
        readdir: async (path: string) => {
          bridgeCalls.push({ method: 'readdir', args: [path] });
          if (path === '/tmp/repo-root') return ['tarfs-file.txt', 'tarfs-dir'];
          return [];
        },
      },
    };
  });

  afterEach(() => {
    delete (globalThis as any).boardVM;
  });

  it('readFile falls back to fsBridge when IDB miss', async () => {
    const content = await vfs.readFile('/tmp/repo-root/tarfs-only.txt');
    expect(content).toBe('content from tarfs base');
    expect(bridgeCalls).toEqual([{ method: 'readFile', args: ['/tmp/repo-root/tarfs-only.txt'] }]);
  });

  it('readFile backfills IDB after fsBridge fallback', async () => {
    await vfs.readFile('/tmp/repo-root/tarfs-only.txt');
    // Second read should NOT call fsBridge (served from IDB backfill)
    bridgeCalls = [];
    const content = await vfs.readFile('/tmp/repo-root/tarfs-only.txt');
    expect(content).toBe('content from tarfs base');
    expect(bridgeCalls).toEqual([]);
  });

  it('stat falls back to fsBridge', async () => {
    const s = await vfs.stat('/tmp/repo-root/tarfs-only.txt');
    expect(s).toEqual({ exists: true, isDir: false, size: 42, mode: 0o644, mtime: 1700000000000 });
    expect(bridgeCalls[0]).toEqual({ method: 'stat', args: ['/tmp/repo-root/tarfs-only.txt'] });
  });

  it('exists falls back to fsBridge', async () => {
    const e = await vfs.exists('/tmp/repo-root/tarfs-dir');
    expect(e).toBe(true);
    expect(bridgeCalls[0]).toEqual({ method: 'exists', args: ['/tmp/repo-root/tarfs-dir'] });
  });

  it('readdir merges IDB entries with fsBridge entries', async () => {
    // Seed an IDB-only file
    await vfs.writeFile('/tmp/repo-root/idb-file.txt', 'local');
    const entries = await vfs.readdir('/tmp/repo-root');
    expect(entries).toContain('idb-file.txt');
    expect(entries).toContain('tarfs-file.txt');
    expect(entries).toContain('tarfs-dir');
    expect(bridgeCalls[0]).toEqual({ method: 'readdir', args: ['/tmp/repo-root'] });
  });
});
