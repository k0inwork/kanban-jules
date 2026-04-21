import { db, YuanChatSession } from '../db';
import { eventBus } from '../../core/event-bus';
import { YuanChatStyle, AskMode } from '../../core/types';

interface SpawnOptions {
  objective: string;
  successCriteria?: string;
  chatStyle: YuanChatStyle;
  sourceMode: AskMode;
  taskId?: string;
  projectId?: string;
  documentContent?: string; // for split view
}

const PERSONA_PROMPTS: Record<YuanChatStyle, string> = {
  explorer: `You are Yuan in Explorer mode. Your job is to draw out the user's thinking through Socratic questioning.
- Ask one question at a time
- Build on previous answers
- Don't jump to solutions — help the user discover them
- When you have enough information, summarize what you've learned
- You can read artifacts and list tasks to understand context`,
  analyst: `You are Yuan in Analyst mode. You are direct and technical.
- Present options with clear tradeoffs
- Read repo files and search code when needed
- Back recommendations with evidence
- Structure your analysis clearly
- When criteria are met, provide a structured summary`,
  worker: `You are Yuan in Worker mode. You collaborate hands-on with the user.
- You can run bash commands, read/write files, and use all available tools
- Do work alongside the user — don't just talk about it
- Show progress as you go
- When done, summarize what was accomplished`,
};

function generateId(): string {
  return `yuan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export class YuanNegotiator {
  /**
   * Spawn a new Yuan chat session with a persona.
   * Emits 'yuan-chat:spawn' for the UI to create a tab.
   * Returns a promise that resolves when the user closes the chat.
   */
  static async spawn(opts: SpawnOptions): Promise<{
    summary: string;
    artifactId?: number;
    chatId: string;
  }> {
    const chatId = generateId();
    const tabLabel = opts.objective.slice(0, 30) + (opts.objective.length > 30 ? '...' : '');

    // Build system prompt
    const systemPrompt = YuanNegotiator.buildSystemPrompt(opts);

    // Create session in DB
    const session: YuanChatSession = {
      id: chatId,
      tabLabel,
      objective: opts.objective,
      successCriteria: opts.successCriteria,
      chatStyle: opts.chatStyle,
      status: 'active',
      sourceMode: opts.sourceMode,
      taskId: opts.taskId,
      projectId: opts.projectId,
      createdAt: Date.now(),
    };
    await db.yuanChatSessions.add(session);

    // Notify UI to open a new Yuan chat tab
    eventBus.emit('yuan-chat:spawn', {
      chatId,
      tabLabel,
      systemPrompt,
      chatStyle: opts.chatStyle,
      objective: opts.objective,
      documentContent: opts.documentContent,
    });

    // Wait for the user to close/resolve the chat
    const result = await new Promise<{ summary: string; fullConversation: string }>((resolve) => {
      const handler = (data: { chatId: string; summary: string; fullConversation: string }) => {
        if (data.chatId === chatId) {
          eventBus.off('yuan-chat:resolved', handler);
          resolve(data);
        }
      };
      eventBus.on('yuan-chat:resolved', handler);
    });

    // Save full conversation as artifact
    let artifactId: number | undefined;
    if (opts.taskId) {
      artifactId = await db.taskArtifacts.add({
        taskId: opts.taskId,
        repoName: '',
        branchName: '',
        name: `yuan-chat-${chatId}`,
        content: result.fullConversation,
        type: 'yuan-chat',
        status: 'approved',
        projectId: opts.projectId,
        createdAt: Date.now(),
      });
    } else if (opts.projectId) {
      // Project-level artifact (no taskId)
      artifactId = await db.taskArtifacts.add({
        taskId: '__project__',
        repoName: '',
        branchName: '',
        name: `yuan-chat-${chatId}`,
        content: result.fullConversation,
        type: 'yuan-chat',
        status: 'approved',
        projectId: opts.projectId,
        createdAt: Date.now(),
      });
    }

    // Update session in DB
    await db.yuanChatSessions.update(chatId, {
      status: 'resolved',
      resolvedAt: Date.now(),
      artifactId,
    });

    return { summary: result.summary, artifactId, chatId };
  }

  /**
   * Abandon a chat session (e.g. timeout or cancellation).
   */
  static async abandon(chatId: string): Promise<void> {
    await db.yuanChatSessions.update(chatId, {
      status: 'abandoned',
      resolvedAt: Date.now(),
    });
    eventBus.emit('yuan-chat:abandoned', { chatId });
  }

  /**
   * Resolve a chat from the UI side (user clicks OK/X).
   */
  static async resolve(chatId: string, summary: string, fullConversation: string): Promise<void> {
    eventBus.emit('yuan-chat:resolved', { chatId, summary, fullConversation });
  }

  /**
   * Build the system prompt for a spawned Yuan chat.
   */
  private static buildSystemPrompt(opts: SpawnOptions): string {
    const parts: string[] = [];

    // Base identity
    parts.push('You are Yuan, an AI assistant in a project management system.');
    parts.push('');

    // Persona
    parts.push(PERSONA_PROMPTS[opts.chatStyle]);
    parts.push('');

    // Objective — framed as a task Yuan must help the USER solve, not answer itself
    parts.push('## Your Task');
    parts.push('You are here to help the user with the following:');
    parts.push('');
    parts.push(`"${opts.objective}"`);
    parts.push('');
    parts.push('IMPORTANT: Do NOT answer this question yourself. Your job is to engage the user, ask follow-up questions, and guide them to their own answer or collect their input.');
    parts.push('');

    // Success criteria
    if (opts.successCriteria) {
      parts.push(`## Success Criteria\nThe conversation is complete when:\n${opts.successCriteria}`);
      parts.push('');
    }

    // Resolution instruction
    parts.push('## Resolution');
    parts.push('When the success criteria are met (or the conversation is naturally complete), summarize the key outcomes in a structured format.');
    parts.push('If criteria are not fully met, note what is still missing.');

    return parts.join('\n');
  }

  /**
   * List active chat sessions.
   */
  static async listActive(projectId?: string): Promise<YuanChatSession[]> {
    let query = db.yuanChatSessions.where('status').equals('active');
    if (projectId) {
      query = query.filter(s => s.projectId === projectId);
    }
    return query.toArray();
  }
}
