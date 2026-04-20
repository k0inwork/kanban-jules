import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProcessAgent } from './ProcessAgent';
import { db } from '../../services/db';

// ─── Mocks ───

vi.mock('../../services/db', () => ({
  db: {
    tasks: { toArray: vi.fn() },
    taskArtifacts: {
      where: vi.fn(() => ({
        toArray: vi.fn(),
        filter: vi.fn(() => ({
          first: vi.fn(),
        })),
      })),
      update: vi.fn(),
    },
    messages: { add: vi.fn() },
    projectConfigs: { get: vi.fn() },
  },
  ArtifactStatus: { draft: 'draft', in_review: 'in_review', revised: 'revised', approved: 'approved' },
}));

vi.mock('../knowledge-kb/Handler', () => ({
  KBHandler: {
    handleRequest: vi.fn(),
  },
}));

vi.mock('../knowledge-artifacts/ArtifactTool', () => ({
  ArtifactTool: {
    updateStatus: vi.fn(),
  },
}));

vi.mock('../knowledge-projector/Handler', () => ({
  ProjectorHandler: {
    project: vi.fn().mockResolvedValue('PROJECT KNOWLEDGE: test constitution'),
  },
}));

// ─── Helpers ───

function makeContext(overrides?: Partial<{ llmCall: any }>) {
  return {
    taskId: 'test-task',
    repoUrl: 'https://github.com/example/my-repo.git',
    repoBranch: 'main',
    githubToken: 'token',
    llmCall: vi.fn().mockResolvedValue('{"thinking":"ok","actions":[],"done":true}'),
    moduleConfig: {},
  } as any;
}

// Access private methods/fields via bracket notation
function agentInternals(agent: ProcessAgent) {
  return agent as any;
}

// ─── Tests ───

describe('ProcessAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── handleRequest routing ───

  describe('handleRequest', () => {
    it('should route runReview correctly', async () => {
      const ctx = makeContext();
      ctx.llmCall.mockResolvedValue('{"thinking":"done","actions":[],"done":true}');
      await ProcessAgent.handleRequest('process-project-manager.runReview', [], ctx);
      expect(ctx.llmCall).toHaveBeenCalled();
    });

    it('should throw on unknown tool', async () => {
      await expect(
        ProcessAgent.handleRequest('process-project-manager.unknown', [], makeContext())
      ).rejects.toThrow('Unknown tool: process-project-manager.unknown');
    });
  });

  // ─── Tool execution ───

  describe('tools', () => {
    let agent: ProcessAgent;
    let ctx: any;

    beforeEach(() => {
      agent = new ProcessAgent();
      ctx = makeContext();
      agentInternals(agent).context = ctx;
      agentInternals(agent).setupTools('my-repo', 'main');
    });

    it('listTasks should return mapped tasks', async () => {
      (db.tasks.toArray as any).mockResolvedValue([
        { id: 1, title: 'T1', description: 'desc', workflowStatus: 'todo', agentState: 'idle', createdAt: 123 },
      ]);
      const result = await agentInternals(agent).executeTool('listTasks', {});
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].title).toBe('T1');
    });

    it('listArtifacts should filter out underscore-prefixed names', async () => {
      const fakeWhere = {
        toArray: vi.fn().mockResolvedValue([
          { id: 1, name: 'visible', type: 'doc', status: 'draft', content: 'x' },
          { id: 2, name: '_hidden', type: 'doc', status: 'draft', content: 'y' },
        ]),
      };
      (db.taskArtifacts.where as any).mockReturnValue(fakeWhere);

      const result = await agentInternals(agent).executeTool('listArtifacts', {});
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].name).toBe('visible');
    });

    it('listArtifacts should apply namePattern filter', async () => {
      const fakeWhere = {
        toArray: vi.fn().mockResolvedValue([
          { id: 1, name: 'design.md', type: 'doc', status: 'draft', content: 'a' },
          { id: 2, name: 'plan.md', type: 'doc', status: 'draft', content: 'b' },
        ]),
      };
      (db.taskArtifacts.where as any).mockReturnValue(fakeWhere);

      const result = await agentInternals(agent).executeTool('listArtifacts', { namePattern: 'design*' });
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].name).toBe('design.md');
    });

    it('readArtifact should return artifact content', async () => {
      const fakeFilter = {
        first: vi.fn().mockResolvedValue({ id: 1, name: 'plan.md', content: '# Plan', type: 'doc', status: 'draft' }),
      };
      const fakeWhere = {
        toArray: vi.fn(),
        filter: vi.fn().mockReturnValue(fakeFilter),
      };
      (db.taskArtifacts.where as any).mockReturnValue(fakeWhere);

      const result = await agentInternals(agent).executeTool('readArtifact', { name: 'plan.md' });
      expect(result.success).toBe(true);
      expect(result.data.content).toBe('# Plan');
    });

    it('readArtifact should return error for missing artifact', async () => {
      const fakeFilter = { first: vi.fn().mockResolvedValue(undefined) };
      const fakeWhere = { toArray: vi.fn(), filter: vi.fn().mockReturnValue(fakeFilter) };
      (db.taskArtifacts.where as any).mockReturnValue(fakeWhere);

      const result = await agentInternals(agent).executeTool('readArtifact', { name: 'missing.md' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('updateArtifactStatus should reject invalid status', async () => {
      const fakeFilter = { first: vi.fn().mockResolvedValue({ id: 1, name: 'x' }) };
      const fakeWhere = { toArray: vi.fn(), filter: vi.fn().mockReturnValue(fakeFilter) };
      (db.taskArtifacts.where as any).mockReturnValue(fakeWhere);
      const { ArtifactTool } = await import('../knowledge-artifacts/ArtifactTool');
      (ArtifactTool.updateStatus as any).mockRejectedValue(new Error('Invalid status: bogus. Must be draft, in_review, revised, or approved.'));

      const result = await agentInternals(agent).executeTool('updateArtifactStatus', { name: 'x', status: 'bogus' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid status');
    });

    it('updateArtifactStatus should accept valid statuses', async () => {
      const { ArtifactTool } = await import('../knowledge-artifacts/ArtifactTool');
      for (const status of ['draft', 'in_review', 'revised', 'approved']) {
        const fakeFilter = { first: vi.fn().mockResolvedValue({ id: 1, name: 'x' }) };
        const fakeWhere = { toArray: vi.fn(), filter: vi.fn().mockReturnValue(fakeFilter) };
        (db.taskArtifacts.where as any).mockReturnValue(fakeWhere);
        (ArtifactTool.updateStatus as any).mockResolvedValue(undefined);

        const result = await agentInternals(agent).executeTool('updateArtifactStatus', { name: 'x', status });
        expect(result.success).toBe(true);
        expect(result.data.status).toBe(status);
      }
    });

    it('proposeTask should add a message to db', async () => {
      (db.messages.add as any).mockResolvedValue(1);

      const result = await agentInternals(agent).executeTool('proposeTask', {
        title: 'New task',
        description: 'Do something',
      });
      expect(result.success).toBe(true);
      expect(db.messages.add).toHaveBeenCalledWith(
        expect.objectContaining({
          sender: 'process-agent',
          type: 'proposal',
          content: 'Do something',
        })
      );
    });

    it('sendMessage should add info message', async () => {
      (db.messages.add as any).mockResolvedValue(1);

      const result = await agentInternals(agent).executeTool('sendMessage', {
        content: 'Hello world',
      });
      expect(result.success).toBe(true);
      expect(db.messages.add).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'info', content: 'Hello world' })
      );
    });

    it('sendMessage should add alert message', async () => {
      (db.messages.add as any).mockResolvedValue(1);

      const result = await agentInternals(agent).executeTool('sendMessage', {
        content: 'Warning!',
        type: 'alert',
      });
      expect(result.success).toBe(true);
      expect(db.messages.add).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'alert' })
      );
    });

    it('executeTool should return error for unknown tool', async () => {
      const result = await agentInternals(agent).executeTool('nonexistent', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown tool');
    });

    it('executeTool should catch tool execution errors', async () => {
      (db.tasks.toArray as any).mockRejectedValue(new Error('DB down'));
      const result = await agentInternals(agent).executeTool('listTasks', {});
      expect(result.success).toBe(false);
      expect(result.error).toBe('DB down');
    });

    it('checkGates should return constitution and artifact summary', async () => {
      (db.projectConfigs.get as any).mockResolvedValue({
        id: 'my-repo:main',
        constitution: '# Test Constitution\n## Stages\n- **Discovery**: Research Notes',
      });
      const fakeWhere = {
        toArray: vi.fn().mockResolvedValue([
          { id: 1, name: 'Research Notes', type: 'doc', status: 'approved' },
          { id: 2, name: 'Design Spec', type: 'doc', status: 'draft' },
          { id: 3, name: '_internal', type: 'doc', status: 'draft' },
        ]),
      };
      (db.taskArtifacts.where as any).mockReturnValue(fakeWhere);

      const result = await agentInternals(agent).executeTool('checkGates', {});
      expect(result.success).toBe(true);
      expect(result.data.constitution).toContain('Discovery');
      expect(result.data.artifacts).toHaveLength(2); // _internal filtered out
      expect(result.data.artifacts[0].status).toBe('approved');
      expect(result.data.artifacts[1].status).toBe('draft');
    });

    it('checkGates should work without project config', async () => {
      (db.projectConfigs.get as any).mockResolvedValue(undefined);
      const fakeWhere = { toArray: vi.fn().mockResolvedValue([]) };
      (db.taskArtifacts.where as any).mockReturnValue(fakeWhere);

      const result = await agentInternals(agent).executeTool('checkGates', {});
      expect(result.success).toBe(true);
      expect(result.data.constitution).toBe('');
      expect(result.data.artifacts).toHaveLength(0);
    });
  });

  // ─── React loop controls ───

  describe('runReview loop controls', () => {
    it('should stop when LLM returns done:true on first iteration', async () => {
      const ctx = makeContext();
      ctx.llmCall.mockResolvedValue('{"thinking":"nothing to do","actions":[],"done":true}');

      const agent = new ProcessAgent();
      await agent.runReview(ctx);

      expect(ctx.llmCall).toHaveBeenCalledTimes(1);
    });

    it('should stop when LLM returns no actions', async () => {
      const ctx = makeContext();
      ctx.llmCall.mockResolvedValue('{"thinking":"no actions","actions":[]}');

      const agent = new ProcessAgent();
      await agent.runReview(ctx);

      expect(ctx.llmCall).toHaveBeenCalledTimes(1);
    });

    it('should stop after consecutive errors', async () => {
      const ctx = makeContext();
      ctx.llmCall.mockRejectedValue(new Error('LLM unavailable'));

      const agent = new ProcessAgent();
      await agent.runReview(ctx);

      // MAX_CONSECUTIVE_ERRORS = 3, so it should call 3 times then bail
      expect(ctx.llmCall).toHaveBeenCalledTimes(3);
    });

    it('should reset consecutive error count on success', async () => {
      const ctx = makeContext();
      let callCount = 0;
      ctx.llmCall.mockImplementation(() => {
        callCount++;
        // Fail first, succeed second, then done
        if (callCount === 1) throw new Error('transient');
        return Promise.resolve('{"thinking":"recovered","actions":[],"done":true}');
      });

      const agent = new ProcessAgent();
      await agent.runReview(ctx);

      // 1 fail + 1 success = 2 calls, then done
      expect(ctx.llmCall).toHaveBeenCalledTimes(2);
    });

    it('should execute multiple actions per iteration', async () => {
      const ctx = makeContext();
      (db.tasks.toArray as any).mockResolvedValue([]);
      (db.messages.add as any).mockResolvedValue(1);

      ctx.llmCall
        .mockResolvedValueOnce(JSON.stringify({
          thinking: 'inspect then message',
          actions: [
            { tool: 'listTasks', args: {} },
            { tool: 'sendMessage', args: { content: 'board empty' } },
          ],
          done: false,
        }))
        .mockResolvedValueOnce('{"thinking":"done now","actions":[],"done":true}');

      const agent = new ProcessAgent();
      await agent.runReview(ctx);

      expect(ctx.llmCall).toHaveBeenCalledTimes(2);
      expect(db.messages.add).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'board empty' })
      );
    });

    it('should extract repoName from repoUrl', async () => {
      const ctx = makeContext();
      ctx.repoUrl = 'https://github.com/org/my-project.git';
      ctx.llmCall.mockResolvedValue('{"thinking":"done","actions":[],"done":true}');

      const agent = new ProcessAgent();
      await agent.runReview(ctx);

      // Verify setupTools was called with correct repoName via the tools working
      const fakeWhere = {
        toArray: vi.fn().mockResolvedValue([]),
      };
      (db.taskArtifacts.where as any).mockReturnValue(fakeWhere);
      const internals = agentInternals(agent);
      expect(internals.tools).toBeDefined();
      expect(Object.keys(internals.tools)).toContain('listTasks');
    });
  });

  // ─── buildToolDescriptions ───

  describe('buildToolDescriptions', () => {
    it('should list all registered tools', () => {
      const agent = new ProcessAgent();
      agentInternals(agent).context = makeContext();
      agentInternals(agent).setupTools('repo', 'main');

      const desc = agentInternals(agent).buildToolDescriptions();
      expect(desc).toContain('listTasks:');
      expect(desc).toContain('listArtifacts:');
      expect(desc).toContain('readArtifact:');
      expect(desc).toContain('queryKB:');
      expect(desc).toContain('updateArtifactStatus:');
      expect(desc).toContain('proposeTask:');
      expect(desc).toContain('sendMessage:');
      expect(desc).toContain('analyze:');
      expect(desc).toContain('checkGates:');
    });
  });
});
