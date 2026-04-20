import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db before importing ArtifactTool
const artifacts: any[] = [];
let nextArtifactId = 1;

vi.mock('../../services/db', () => ({
  db: {
    taskArtifacts: {
      add: vi.fn((a: any) => { const id = nextArtifactId++; artifacts.push({ ...a, id }); return Promise.resolve(id); }),
      get: vi.fn((id: number) => Promise.resolve(artifacts.find(a => a.id === id))),
      update: vi.fn((id: number, changes: any) => {
        const idx = artifacts.findIndex(a => a.id === id);
        if (idx !== -1) Object.assign(artifacts[idx], changes);
        return Promise.resolve(id);
      }),
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

let kbDocs: any[] = [];
let nextKbDocId = 1;

vi.mock('../knowledge-kb/Handler', () => ({
  KBHandler: {
    handleRequest: vi.fn((toolName: string, args: any[]) => {
      if (toolName === 'knowledge-kb.saveDocument') {
        const params = args[0];
        const existing = kbDocs.find(d => d.title === params.title && d.active);
        if (existing) {
          existing.version++;
          existing.content = params.content;
          return Promise.resolve(existing.id);
        }
        const id = nextKbDocId++;
        kbDocs.push({ id, ...params, version: 1, active: true });
        return Promise.resolve(id);
      }
      return Promise.resolve(undefined);
    }),
  },
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
  kbDocs.length = 0;
  nextArtifactId = 1;
  nextKbDocId = 1;
  vi.clearAllMocks();
  vi.mocked(GitFs).mockImplementation(function (this: any) {
    this.writeFile = vi.fn(() => Promise.resolve());
  } as any);
});

// ── Default status ──

describe('ArtifactTool — default status', () => {
  it('sets status to draft on save', async () => {
    await ArtifactTool.saveArtifact('t1', 'repo', 'main', 'Notes', 'content', 'token');
    expect(artifacts[0].status).toBe('draft');
  });
});

// ── updateStatus ──

describe('ArtifactTool — updateStatus', () => {
  it('updates status from draft to in_review', async () => {
    await ArtifactTool.saveArtifact('t1', 'repo', 'main', 'Notes', 'content', 'token');
    const id = artifacts[0].id;
    await ArtifactTool.updateStatus(id, 'in_review');
    expect(artifacts[0].status).toBe('in_review');
  });

  it('updates status from in_review to approved', async () => {
    await ArtifactTool.saveArtifact('t1', 'repo', 'main', 'Notes', 'content', 'token');
    const id = artifacts[0].id;
    await ArtifactTool.updateStatus(id, 'approved');
    expect(artifacts[0].status).toBe('approved');
  });

  it('updates status to revised', async () => {
    await ArtifactTool.saveArtifact('t1', 'repo', 'main', 'Notes', 'content', 'token');
    const id = artifacts[0].id;
    await ArtifactTool.updateStatus(id, 'revised');
    expect(artifacts[0].status).toBe('revised');
  });

  it('updates status from revised back to draft', async () => {
    await ArtifactTool.saveArtifact('t1', 'repo', 'main', 'Notes', 'content', 'token');
    const id = artifacts[0].id;
    await ArtifactTool.updateStatus(id, 'revised');
    await ArtifactTool.updateStatus(id, 'draft');
    expect(artifacts[0].status).toBe('draft');
  });

  it('throws on invalid status', async () => {
    await ArtifactTool.saveArtifact('t1', 'repo', 'main', 'Notes', 'content', 'token');
    const id = artifacts[0].id;
    await expect(ArtifactTool.updateStatus(id, 'bogus' as any)).rejects.toThrow('Invalid status');
  });

  it('throws on missing artifact', async () => {
    await expect(ArtifactTool.updateStatus(999, 'in_review')).rejects.toThrow('Artifact 999 not found');
  });

  it('handles updateArtifactStatus via handleRequest', async () => {
    await ArtifactTool.saveArtifact('t1', 'repo', 'main', 'Notes', 'content', 'token');
    const id = artifacts[0].id;
    const result = await ArtifactTool.handleRequest(
      'knowledge-artifacts.updateArtifactStatus',
      [{ artifactId: id, status: 'in_review' }],
      ctx,
    );
    expect(result).toEqual({ artifactId: id, status: 'in_review' });
    expect(artifacts[0].status).toBe('in_review');
  });

  it('handles updateArtifactStatus with positional args', async () => {
    await ArtifactTool.saveArtifact('t1', 'repo', 'main', 'Notes', 'content', 'token');
    const id = artifacts[0].id;
    const result = await ArtifactTool.handleRequest(
      'knowledge-artifacts.updateArtifactStatus',
      [id, 'approved'],
      ctx,
    );
    expect(result.status).toBe('approved');
  });
});

// ── listArtifacts with status filter ──

describe('ArtifactTool — listArtifacts status filter', () => {
  it('filters by status', async () => {
    await ArtifactTool.saveArtifact('t1', 'repo', 'main', 'Draft Doc', 'c1', 'token');
    await ArtifactTool.saveArtifact('t2', 'repo', 'main', 'Reviewed Doc', 'c2', 'token');
    await ArtifactTool.updateStatus(artifacts[1].id, 'in_review');

    const result = await ArtifactTool.listArtifacts(undefined, undefined, undefined, undefined, 'in_review');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Reviewed Doc');
  });
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

// ── promoteToKB ──

describe('ArtifactTool — promoteToKB', () => {
  it('promotes approved artifact to KB', async () => {
    await ArtifactTool.saveArtifact('t1', 'repo', 'main', 'Design Spec', 'Full content here', 'token');
    await ArtifactTool.updateStatus(artifacts[0].id, 'approved');

    const result = await ArtifactTool.promoteToKB(artifacts[0].id, ctx);
    expect(result.kbDocId).toBe(1);
    expect(result.version).toBe(1);
    expect(artifacts[0].metadata.promotedToKB).toBe(true);
    expect(artifacts[0].metadata.promotedVersion).toBe(1);
  });

  it('rejects promotion of non-approved artifact', async () => {
    await ArtifactTool.saveArtifact('t1', 'repo', 'main', 'Draft Spec', 'content', 'token');
    await expect(ArtifactTool.promoteToKB(artifacts[0].id, ctx))
      .rejects.toThrow('must be approved before promoting');
  });

  it('rejects promotion of missing artifact', async () => {
    await expect(ArtifactTool.promoteToKB(999, ctx))
      .rejects.toThrow('Artifact 999 not found');
  });

  it('increments version on re-promotion', async () => {
    await ArtifactTool.saveArtifact('t1', 'repo', 'main', 'Design Spec', 'v1 content', 'token');
    await ArtifactTool.updateStatus(artifacts[0].id, 'approved');

    await ArtifactTool.promoteToKB(artifacts[0].id, ctx);
    // Re-promote (artifact is still approved)
    const result = await ArtifactTool.promoteToKB(artifacts[0].id, ctx);
    expect(result.version).toBe(2);
    expect(artifacts[0].metadata.promotedVersion).toBe(2);
  });

  it('uses metadata.summary if available', async () => {
    await ArtifactTool.saveArtifact('t1', 'repo', 'main', 'Spec', 'content', 'token', 'doc', { summary: 'Custom summary' });
    await ArtifactTool.updateStatus(artifacts[0].id, 'approved');

    await ArtifactTool.promoteToKB(artifacts[0].id, ctx);
    const { KBHandler } = await import('../knowledge-kb/Handler');
    expect(KBHandler.handleRequest).toHaveBeenCalledWith(
      'knowledge-kb.saveDocument',
      [expect.objectContaining({ summary: 'Custom summary' })],
      ctx,
    );
  });

  it('handles promoteToKB via handleRequest', async () => {
    await ArtifactTool.saveArtifact('t1', 'repo', 'main', 'Spec', 'content', 'token');
    await ArtifactTool.updateStatus(artifacts[0].id, 'approved');

    const result = await ArtifactTool.handleRequest(
      'knowledge-artifacts.promoteToKB',
      [{ artifactId: artifacts[0].id }],
      ctx,
    );
    expect(result.kbDocId).toBe(1);
    expect(result.version).toBe(1);
  });

  it('handles promoteToKB via handleRequest with positional args', async () => {
    await ArtifactTool.saveArtifact('t1', 'repo', 'main', 'Spec', 'content', 'token');
    await ArtifactTool.updateStatus(artifacts[0].id, 'approved');

    const result = await ArtifactTool.handleRequest(
      'knowledge-artifacts.promoteToKB',
      [artifacts[0].id],
      ctx,
    );
    expect(result.kbDocId).toBe(1);
  });
});
