import { db, Artifact, ArtifactStatus } from '../../services/db';
import { RequestContext } from '../../core/types';
import { KBHandler } from '../knowledge-kb/Handler';
import { ProjectorHandler } from '../knowledge-projector/Handler';

const MAX_ITERATIONS = 10;
const MAX_TOTAL_TOKENS = 80_000;       // ~80k chars ≈ 20k tokens rough estimate
const MAX_TOKENS_PER_ITERATION = 16_000; // ~16k chars ≈ 4k tokens per turn
const MAX_CONSECUTIVE_ERRORS = 3;
const WALL_CLOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
}

export class ProcessAgent {
  private context!: RequestContext;
  private iterationLog: string[] = [];

  // ─── Tool Definitions ───

  private tools: Record<string, { description: string; execute: (args: any) => Promise<ToolResult> }> = {};

  private setupTools(repoName: string, branchName: string) {
    this.tools = {
      listTasks: {
        description: 'List all tasks on the board with their status, agentState, title, description',
        execute: async () => {
          const tasks = await db.tasks.toArray();
          return { success: true, data: tasks.map(t => ({
            id: t.id, title: t.title, description: t.description,
            workflowStatus: t.workflowStatus, agentState: t.agentState,
            createdAt: t.createdAt
          }))};
        }
      },
      listArtifacts: {
        description: 'List all artifacts with name, status, type. Optionally filter by namePattern (glob).',
        execute: async (args?: { namePattern?: string }) => {
          let artifacts = await db.taskArtifacts.where({ repoName, branchName }).toArray();
          artifacts = artifacts.filter(a => typeof a.name !== 'string' || !a.name.startsWith('_'));
          if (args?.namePattern) {
            const pattern = args.namePattern.replace(/\*/g, '.*');
            const re = new RegExp(`^${pattern}$`);
            artifacts = artifacts.filter(a => re.test(a.name));
          }
          return { success: true, data: artifacts.map(a => ({
            id: a.id, name: a.name, type: a.type, status: a.status || 'draft',
            contentLength: (a.content || '').length
          }))};
        }
      },
      readArtifact: {
        description: 'Read the full content of an artifact by name',
        execute: async (args: { name: string }) => {
          const artifact = await db.taskArtifacts.where({ repoName, branchName }).filter(a => a.name === args.name).first();
          if (!artifact) return { success: false, error: `Artifact "${args.name}" not found` };
          return { success: true, data: { name: artifact.name, content: artifact.content, type: artifact.type, status: artifact.status || 'draft' }};
        }
      },
      queryKB: {
        description: 'Search knowledge base docs. Args: { search?, tags?, type?, category?, limit? }',
        execute: async (args: { search?: string; tags?: string[]; type?: string; category?: string; limit?: number }) => {
          const results = await KBHandler.handleRequest('knowledge-kb.queryDocs', [{
            project: 'target',
            search: args.search,
            tags: args.tags,
            type: args.type,
            limit: args.limit || 10
          }], this.context);
          return { success: true, data: results };
        }
      },
      queryKBLog: {
        description: 'Search knowledge base log entries. Args: { search?, category?, tags?, limit? }',
        execute: async (args: { category?: string; tags?: string[]; limit?: number }) => {
          const results = await KBHandler.handleRequest('knowledge-kb.queryLog', [{
            project: 'target',
            category: args.category,
            tags: args.tags,
            active: true,
            limit: args.limit || 10
          }], this.context);
          return { success: true, data: results };
        }
      },
      saveToKB: {
        description: 'Save an artifact to KB docs. Args: { artifactName, docType?, tags?, summary? }',
        execute: async (args: { artifactName: string; docType?: string; tags?: string[]; summary?: string }) => {
          const artifact = await db.taskArtifacts.where({ repoName, branchName }).filter(a => a.name === args.artifactName).first();
          if (!artifact) return { success: false, error: `Artifact "${args.artifactName}" not found` };

          const summary = args.summary || artifact.content.substring(0, 200) + '...';
          await KBHandler.handleRequest('knowledge-kb.saveDocument', [{
            title: artifact.name,
            type: args.docType || artifact.type || 'artifact',
            content: artifact.content,
            summary,
            tags: args.tags || [artifact.type || 'artifact'],
            layer: ['L1'],
            source: 'process-agent'
          }], this.context);
          return { success: true, data: { saved: artifact.name } };
        }
      },
      updateArtifactStatus: {
        description: 'Update artifact lifecycle status. Args: { name, status: "draft"|"reviewed"|"approved" }',
        execute: async (args: { name: string; status: string }) => {
          const artifact = await db.taskArtifacts.where({ repoName, branchName }).filter(a => a.name === args.name).first();
          if (!artifact) return { success: false, error: `Artifact "${args.name}" not found` };
          if (!['draft', 'reviewed', 'approved'].includes(args.status)) {
            return { success: false, error: `Invalid status: ${args.status}` };
          }
          await db.taskArtifacts.update(artifact.id!, { status: args.status as ArtifactStatus });
          return { success: true, data: { name: args.name, status: args.status } };
        }
      },
      analyze: {
        description: 'Use LLM to analyze data. Args: { prompt, data }',
        execute: async (args: { prompt: string; data: any }) => {
          const fullPrompt = `${args.prompt}\n\nData:\n${typeof args.data === 'string' ? args.data : JSON.stringify(args.data, null, 2)}`;
          const result = await this.context.llmCall(fullPrompt);
          return { success: true, data: result };
        }
      },
      proposeTask: {
        description: 'Propose a new task to the user. Args: { title, description, type? }',
        execute: async (args: { title: string; description: string; type?: string }) => {
          await db.messages.add({
            sender: 'process-agent',
            type: 'proposal',
            content: args.description,
            proposedTask: { title: args.title, description: args.description },
            status: 'unread',
            timestamp: Date.now()
          });
          return { success: true, data: { proposed: args.title } };
        }
      },
      sendMessage: {
        description: 'Send info/alert to user. Args: { content, type: "info"|"alert" }',
        execute: async (args: { content: string; type?: 'info' | 'alert' }) => {
          await db.messages.add({
            sender: 'process-agent',
            type: args.type || 'info',
            content: args.content,
            status: 'unread',
            timestamp: Date.now()
          });
          return { success: true, data: { sent: true } };
        }
      }
    };
  }

  // ─── Tool Execution ───

  private async executeTool(name: string, args: any): Promise<ToolResult> {
    const tool = this.tools[name];
    if (!tool) return { success: false, error: `Unknown tool: ${name}` };
    try {
      return await tool.execute(args || {});
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  // ─── React Loop ───

  private buildToolDescriptions(): string {
    return Object.entries(this.tools)
      .map(([name, t]) => `- ${name}: ${t.description}`)
      .join('\n');
  }

  async runReview(context: RequestContext): Promise<void> {
    this.context = context;
    const repoName = context.repoUrl.split('/').pop() || context.repoUrl;
    const branchName = context.repoBranch;
    this.setupTools(repoName, branchName);
    this.iterationLog = [];

    console.log('[ProcessAgent] Starting react-loop review...');

    // Get project knowledge (constitution + overseer rules)
    const projectedKnowledge = await ProjectorHandler.project({
      layer: 'L1', project: 'target', taskDescription: 'project review board analysis'
    });

    const startTime = Date.now();
    let totalTokensUsed = 0;
    let consecutiveErrors = 0;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      // ── Wall-clock timeout check ──
      if (Date.now() - startTime > WALL_CLOCK_TIMEOUT_MS) {
        console.log('[ProcessAgent] Wall-clock timeout exceeded. Stopping.');
        break;
      }

      // ── Token budget check ──
      if (totalTokensUsed >= MAX_TOTAL_TOKENS) {
        console.log('[ProcessAgent] Token budget exhausted. Stopping.');
        break;
      }

      // ── Consecutive error check ──
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.log('[ProcessAgent] Too many consecutive errors. Stopping.');
        break;
      }

      const logBlock = this.iterationLog.length > 0
        ? `\nPREVIOUS ITERATIONS:\n${this.iterationLog.join('\n')}\n`
        : '';

      const prompt = `${projectedKnowledge}

${logBlock}
You are the Project Overseer. You have tools to observe the board and act.

AVAILABLE TOOLS:
${this.buildToolDescriptions()}

INSTRUCTIONS:
1. Start by listing tasks and artifacts to understand current state.
2. Check which artifacts exist, their status (draft/reviewed/approved), and their quality.
3. Use queryKB to find relevant knowledge for context.
4. Determine what stage the project is in based on the CONSTITUTION and which artifacts are approved.
5. Identify gaps — missing artifacts, unreviewed work, tasks that need follow-up.
6. If you find something actionable: proposeTask or sendMessage.
7. If artifacts are mature and correct: updateArtifactStatus to reviewed/approved.
8. If approved artifacts should be in KB: saveToKB.

RULES:
- Do NOT propose tasks that already exist on the board.
- Do NOT repeat proposals already sent in messages.
- Be specific about WHY you're proposing something.
- When reviewing artifacts, check substance not just existence.

Respond in JSON:
{
  "thinking": "Your reasoning about current state",
  "actions": [
    { "tool": "toolName", "args": { ... } }
  ],
  "done": true/false
}

Set "done": true when you have no more actions to take.`;

      // ── Per-iteration token cap ──
      const remainingTokens = MAX_TOTAL_TOKENS - totalTokensUsed;
      const iterationCap = Math.min(MAX_TOKENS_PER_ITERATION, remainingTokens);
      // Approximate: truncate prompt if it exceeds iteration cap
      const cappedPrompt = prompt.length > iterationCap
        ? prompt.substring(0, iterationCap) + '\n... [truncated]'
        : prompt;

      try {
        const responseText = await context.llmCall(cappedPrompt, true);
        const result = JSON.parse(responseText || '{}');

        // Track approximate token usage (chars ÷ 4 ≈ tokens)
        totalTokensUsed += Math.ceil((cappedPrompt.length + (responseText || '').length) / 4);
        consecutiveErrors = 0;

        this.iterationLog.push(`Iteration ${i + 1} (${totalTokensUsed} tokens used): ${result.thinking || '(no thinking)'}`);

        if (!result.actions || result.actions.length === 0 || result.done) {
          console.log(`[ProcessAgent] Done after ${i + 1} iterations.`);
          break;
        }

        for (const action of result.actions) {
          const toolResult = await this.executeTool(action.tool, action.args);
          this.iterationLog.push(`  → ${action.tool}(${JSON.stringify(action.args).substring(0, 100)}): ${toolResult.success ? 'ok' : 'ERR: ' + toolResult.error}`);
        }
      } catch (error: any) {
        consecutiveErrors++;
        totalTokensUsed += Math.ceil(cappedPrompt.length / 4);
        console.error(`[ProcessAgent] Iteration ${i + 1} failed (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}):`, error);
        this.iterationLog.push(`  → ERROR: ${error.message}`);
      }
    }

    console.log(`[ProcessAgent] Review complete. Tokens: ~${totalTokensUsed}, Iterations: ${this.iterationLog.length}, Time: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  }

  // ─── Static Handler ───

  static async handleRequest(toolName: string, args: any[], context: RequestContext): Promise<any> {
    const agent = new ProcessAgent();
    switch (toolName) {
      case 'process-project-manager.runReview':
        return await agent.runReview(context);
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }
}
