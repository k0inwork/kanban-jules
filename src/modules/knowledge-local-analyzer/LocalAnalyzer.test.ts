import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock with vi.fn() (constructable), set implementations in beforeEach
vi.mock('../../services/GitFs', () => ({
  GitFs: vi.fn(),
}));

vi.mock('../../services/TaskFs', () => ({
  TaskFs: vi.fn(),
}));

vi.mock('../../services/db', () => ({
  db: {
    tasks: {
      get: vi.fn(() => Promise.resolve({ id: 't1', title: 'Security Scan' })),
    },
  },
}));

import { LocalAnalyzer } from './LocalAnalyzer';
import { GitFs } from '../../services/GitFs';
import { TaskFs } from '../../services/TaskFs';
import { db } from '../../services/db';

const ctx = {
  taskId: 't1',
  repoUrl: 'owner/repo',
  repoBranch: 'main',
  githubToken: 'ghp_test',
  llmCall: vi.fn(),
  moduleConfig: {},
} as any;

let mockFiles: { path: string; type: string }[];
let mockFileContents: Record<string, string>;

beforeEach(() => {
  mockFiles = [];
  mockFileContents = {};

  vi.mocked(GitFs).mockImplementation(function (this: any) {
    this.listFiles = vi.fn(() => Promise.resolve(mockFiles));
    this.getFile = vi.fn((path: string) => Promise.resolve(mockFileContents[path] || ''));
  } as any);

  vi.mocked(TaskFs).mockImplementation(function (this: any) {
    this.saveArtifact = vi.fn(() => Promise.resolve(1));
  } as any);
});

describe('LocalAnalyzer', () => {
  it('throws on unknown tool', async () => {
    await expect(LocalAnalyzer.handleRequest('knowledge-local-analyzer.unknown', [], ctx))
      .rejects.toThrow('Unknown tool: knowledge-local-analyzer.unknown');
  });

  it('finds files matching default patterns', async () => {
    mockFiles = [
      { path: 'config.yml', type: 'file' },
      { path: 'README.md', type: 'file' },
    ];
    mockFileContents = {
      'config.yml': 'database:\n  password: supersecret',
      'README.md': '# Hello World',
    };

    const findings = await LocalAnalyzer.handleRequest('knowledge-local-analyzer.scan', [{}], ctx);
    expect(findings.length).toBe(1);
    expect(findings[0]).toContain('config.yml');
    expect(findings[0]).toContain('Pattern found');
  });

  it('finds files matching custom patterns', async () => {
    mockFiles = [{ path: 'app.ts', type: 'file' }];
    mockFileContents = { 'app.ts': 'const apiKey = "abc123"' };

    const findings = await LocalAnalyzer.handleRequest(
      'knowledge-local-analyzer.scan',
      [{ patterns: ['apikey'] }],
      ctx,
    );
    expect(findings.length).toBe(1);
    expect(findings[0]).toContain('app.ts');
  });

  it('reports no patterns found when nothing matches', async () => {
    mockFiles = [{ path: 'clean.ts', type: 'file' }];
    mockFileContents = { 'clean.ts': 'export const add = (a: number, b: number) => a + b;' };

    const findings = await LocalAnalyzer.handleRequest('knowledge-local-analyzer.scan', [{}], ctx);
    expect(findings.length).toBe(1);
    expect(findings[0]).toContain('No patterns found');
  });

  it('ignores directory entries from listFiles', async () => {
    mockFiles = [
      { path: 'src', type: 'dir' },
      { path: 'secret.txt', type: 'file' },
    ];
    mockFileContents = { 'secret.txt': 'password=hunter2' };

    const findings = await LocalAnalyzer.handleRequest('knowledge-local-analyzer.scan', [{}], ctx);
    expect(findings.length).toBe(1);
    expect(findings[0]).toContain('secret.txt');
  });

  it('pattern matching is case insensitive', async () => {
    mockFiles = [{ path: 'notes.txt', type: 'file' }];
    mockFileContents = { 'notes.txt': 'The SECRET is here' };

    const findings = await LocalAnalyzer.handleRequest(
      'knowledge-local-analyzer.scan',
      [{ patterns: ['secret'] }],
      ctx,
    );
    expect(findings.length).toBe(1);
  });

  it('handles empty file list', async () => {
    mockFiles = [];
    mockFileContents = {};

    const findings = await LocalAnalyzer.handleRequest('knowledge-local-analyzer.scan', [{}], ctx);
    expect(findings).toEqual(['Security Scan: No patterns found']);
  });

  it('finds multiple matching files', async () => {
    mockFiles = [
      { path: 'a.env', type: 'file' },
      { path: 'b.env', type: 'file' },
      { path: 'clean.ts', type: 'file' },
    ];
    mockFileContents = {
      'a.env': 'PASSWORD=abc',
      'b.env': 'secret=xyz',
      'clean.ts': 'export const x = 1;',
    };

    const findings = await LocalAnalyzer.handleRequest('knowledge-local-analyzer.scan', [{}], ctx);
    expect(findings.length).toBe(2);
  });

  it('uses task title in artifact name', async () => {
    mockFiles = [{ path: 'f.txt', type: 'file' }];
    mockFileContents = { 'f.txt': 'password=x' };

    const findings = await LocalAnalyzer.handleRequest('knowledge-local-analyzer.scan', [{}], ctx);
    expect(findings[0]).toContain('Security Scan');
  });

  it('handles missing task gracefully', async () => {
    (db.tasks.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    mockFiles = [];
    mockFileContents = {};

    const findings = await LocalAnalyzer.handleRequest('knowledge-local-analyzer.scan', [{}], ctx);
    expect(findings[0]).toContain('Task Analysis');
  });
});
