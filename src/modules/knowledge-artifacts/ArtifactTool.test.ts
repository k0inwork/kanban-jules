import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db before importing ArtifactTool
const artifacts: any[] = [];
let nextArtifactId = 1;

vi.mock('../../services/db', () => ({
  db: {
    taskArtifacts: {
      add: vi.fn((a: any) => { const id = nextArtifactId++; artifacts.push({ ...a, id }); return Promise.resolve(id); }),
      get: vi.fn((id: number) => Promise.resolve(artifacts.find(a => a.id === id))),
      toArray: vi.fn(() => Promise.resolve([...artifacts])),
      where: vi.fn(() => ({
        equals: vi.fn(() => ({ toArray: vi.fn(() => Promise.resolve([...artifacts])) })),
      })),
    },
  },
}));

vi.mock('../../services/GitFs', () => ({
  GitFs: vi.fn(),
}));

import { ArtifactTool } from './ArtifactTool';
import { GitFs } from '../../services/GitFs';

const ctx = {
  taskId: 'task-1',
  repoUrl: 'owner/repo',
  repoBranch: 'main',
  githubToken: 'ghp_test',
  llmCall: vi.fn(),
  moduleConfig: {},
} as any;

beforeEach(() => {
  artifacts.length = 0;
  nextArtifactId = 1;
  vi.clearAllMocks();
  vi.mocked(GitFs).mockImplementation(function (this: any) {
    this.writeFile = vi.fn(() => Promise.resolve());
  } as any);
});

// ── handleRequest routing ──

describe('ArtifactTool — routing', () => {
  it('throws on unknown tool', async () => {
    await expect(ArtifactTool.handleRequest('knowledge-artifacts.unknown', [], ctx))
      .rejects.toThrow('Tool not found: knowledge-artifacts.unknown');
  });
});

// ── listArtifacts ──

describe('ArtifactTool — listArtifacts', () => {
  it('returns all artifacts when no filters', async () => {
    artifacts.push(
      { id: 1, taskId: 't1', name: 'Public artifact', repoName: 'repo', branchName: 'main', content: 'c1' },
      { id: 2, taskId: 't2', name: 'Another', repoName: 'repo', branchName: 'dev', content: 'c2' },
    );
    const result = await ArtifactTool.listArtifacts();
    expect(result.length).toBe(2);
  });

  it('filters out underscore-prefixed artifacts from other tasks', async () => {
    artifacts.push(
      { id: 1, taskId: 'task-1', name: 'Public', repoName: 'r', branchName: 'b', content: 'c' },
      { id: 2, taskId: 'task-2', name: '_Private', repoName: 'r', branchName: 'b', content: 'c' },
    );
    const result = await ArtifactTool.listArtifacts(undefined, undefined, undefined, 'task-1');
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('Public');
  });

  it('includes underscore-prefixed artifacts when requesting task owns them', async () => {
    artifacts.push(
      { id: 1, taskId: 'task-1', name: '_Private', repoName: 'r', branchName: 'b', content: 'c' },
    );
    const result = await ArtifactTool.listArtifacts(undefined, undefined, undefined, 'task-1');
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('_Private');
  });

  it('handles handleRequest with positional args', async () => {
    artifacts.push(
      { id: 1, taskId: 'task-1', name: 'A1', repoName: 'owner/repo', branchName: 'main', content: 'c' },
    );
    const result = await ArtifactTool.handleRequest('knowledge-artifacts.listArtifacts', ['task-1'], ctx);
    expect(result).toBeDefined();
  });

  it('handles handleRequest with object-form args', async () => {
    artifacts.push(
      { id: 1, taskId: 'task-1', name: 'A1', repoName: 'owner/repo', branchName: 'main', content: 'c' },
    );
    const result = await ArtifactTool.handleRequest(
      'knowledge-artifacts.listArtifacts',
      [{ taskId: 'task-1' }],
      ctx,
    );
    expect(result).toBeDefined();
  });
});

// ── readArtifact ──

describe('ArtifactTool — readArtifact', () => {
  it('returns artifact by ID', async () => {
    artifacts.push({ id: 42, taskId: 't1', name: 'Found', content: 'hello' });
    const result = await ArtifactTool.readArtifact(42);
    expect(result?.name).toBe('Found');
  });

  it('returns undefined for missing ID', async () => {
    const result = await ArtifactTool.readArtifact(999);
    expect(result).toBeUndefined();
  });

  it('handles handleRequest with object-form args', async () => {
    artifacts.push({ id: 5, taskId: 't1', name: 'Test', content: 'x' });
    const result = await ArtifactTool.handleRequest(
      'knowledge-artifacts.readArtifact',
      [{ artifactId: 5 }],
      ctx,
    );
    expect(result.name).toBe('Test');
  });
});

// ── saveArtifact ──

describe('ArtifactTool — saveArtifact', () => {
  it('saves artifact to db and returns ID', async () => {
    const id = await ArtifactTool.saveArtifact('t1', 'repo', 'main', 'Notes', 'content', 'token');
    expect(id).toBe(1);
    expect(artifacts[0].name).toBe('Notes');
    expect(artifacts[0].content).toBe('content');
  });

  it('writes to GitFs when token provided and name not underscore-prefixed', async () => {
    await ArtifactTool.saveArtifact('t1', 'repo', 'main', 'Public', 'data', 'token');
    expect(GitFs).toHaveBeenCalledWith('repo', 'main', 'token');
  });

  it('skips GitFs write for underscore-prefixed names', async () => {
    await ArtifactTool.saveArtifact('t1', 'repo', 'main', '_internal', 'data', 'token');
    // GitFs constructor may still be called from other tests; check writeFile not called on instance
    // The mock creates a new instance each time, so we check the last call
    expect(GitFs).not.toHaveBeenCalledWith('repo', 'main', 'token');
    // Actually, the function returns early because name starts with '_', so no new GitFs is created
  });

  it('skips GitFs write when no token', async () => {
    await ArtifactTool.saveArtifact('t1', 'repo', 'main', 'Notes', 'data', '');
    expect(artifacts[0].name).toBe('Notes');
  });

  it('handles handleRequest with object-form args', async () => {
    const result = await ArtifactTool.handleRequest(
      'knowledge-artifacts.saveArtifact',
      [{ name: 'New', content: 'hello', type: 'text', metadata: { key: 'val' } }],
      ctx,
    );
    expect(result).toBe(1);
    expect(artifacts[0].type).toBe('text');
    expect(artifacts[0].metadata).toEqual({ key: 'val' });
  });
});
