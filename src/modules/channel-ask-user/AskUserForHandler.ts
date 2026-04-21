import { RequestContext, AskMode, AskOptions, AskResult } from '../../core/types';
import { YuanNegotiator } from '../../services/negotiators/YuanNegotiator';
import { db } from '../../services/db';
import { eventBus } from '../../core/event-bus';

export class AskUserForHandler {
  async handleRequest(toolName: string, args: any[], context: RequestContext): Promise<string> {
    if (toolName !== 'channel-ask-user.askUserFor') {
      throw new Error(`Unknown tool: ${toolName}`);
    }
    const result = await this.askUserFor(args, context);
    // Return the plain value string — agent code expects a simple string, not an object
    return result.value;
  }

  private async askUserFor(args: any[], context: RequestContext): Promise<AskResult> {
    const unpack = (arg: any) =>
      arg && typeof arg === 'object' && !Array.isArray(arg) ? arg : null;
    const obj = unpack(args[0]);
    const prompt: string = obj ? obj.prompt : args[0] || '';
    const mode: AskMode = obj ? obj.mode : args[1] || 'text';
    const options: AskOptions = obj ? obj.options : args[2] || {};

    if (!prompt) {
      throw new Error('prompt is required');
    }

    switch (mode) {
      case 'chat':
        return this.handleChat(prompt, options, context);
      case 'choice':
        return this.handleChoice(prompt, options, context);
      case 'document':
        return this.handleDocument(prompt, options, context);
      case 'artifact':
        return this.handleArtifact(prompt, options, context);
      case 'file':
        return this.handleFile(prompt, options, context);
      case 'text':
      default:
        return this.handleText(prompt, options, context);
    }
  }

  private async handleChat(prompt: string, options: AskOptions, context: RequestContext): Promise<AskResult> {
    const result = await YuanNegotiator.spawn({
      objective: prompt,
      successCriteria: options.successCriteria,
      chatStyle: options.chatStyle || 'explorer',
      sourceMode: 'chat',
      taskId: context.taskId,
      projectId: context.projectId,
    });

    return {
      mode: 'chat',
      value: result.summary,
      artifactId: result.artifactId,
      chatId: result.chatId,
    };
  }

  /**
   * For non-chat modes: create a mail card with mode-specific content,
   * wait for the user to interact (direct reply or escalation to chat).
   */
  private async handleChoice(prompt: string, options: AskOptions, context: RequestContext): Promise<AskResult> {
    const mailId = await this.sendMailCard(context, {
      mode: 'choice',
      prompt,
      choices: options.choices || [],
    });

    return this.waitForMailResponse(mailId, 'choice', context);
  }

  private async handleText(prompt: string, options: AskOptions, context: RequestContext): Promise<AskResult> {
    const mailId = await this.sendMailCard(context, {
      mode: 'text',
      prompt,
    });

    return this.waitForMailResponse(mailId, 'text', context);
  }

  private async handleDocument(prompt: string, options: AskOptions, context: RequestContext): Promise<AskResult> {
    const mailId = await this.sendMailCard(context, {
      mode: 'document',
      prompt,
      documentType: options.documentType,
      template: options.template,
    });

    return this.waitForMailResponse(mailId, 'document', context);
  }

  private async handleArtifact(prompt: string, options: AskOptions, context: RequestContext): Promise<AskResult> {
    const mailId = await this.sendMailCard(context, {
      mode: 'artifact',
      prompt,
    });

    return this.waitForMailResponse(mailId, 'artifact', context);
  }

  private async handleFile(prompt: string, options: AskOptions, context: RequestContext): Promise<AskResult> {
    const mailId = await this.sendMailCard(context, {
      mode: 'file',
      prompt,
    });

    return this.waitForMailResponse(mailId, 'file', context);
  }

  /**
   * Send a mail card that renders an askUserFor interaction.
   * The card's metadata carries the mode and options so the UI knows what to render.
   */
  private async sendMailCard(context: RequestContext, cardData: {
    mode: AskMode;
    prompt: string;
    choices?: string[];
    documentType?: string;
    template?: string;
  }): Promise<number> {
    const mailId = await db.messages.add({
      sender: 'agent',
      taskId: context.taskId,
      type: 'alert',
      content: cardData.prompt,
      status: 'unread',
      timestamp: Date.now(),
      // Store askUserFor card metadata in a structured field
      // The UI will detect this and render AskUserForCard instead of plain text
      category: 'SIGNAL',
      proposedTask: {
        title: `askUserFor:${cardData.mode}`,
        description: JSON.stringify(cardData),
      },
    });
    return mailId;
  }

  /**
   * Wait for the user to respond to a mail card.
   * Handles both direct responses and escalation to chat mode.
   */
  private async waitForMailResponse(mailId: number, originalMode: AskMode, context: RequestContext): Promise<AskResult> {
    // Set task state
    await db.tasks.update(context.taskId, {
      workflowStatus: 'IN_PROGRESS',
      agentState: 'WAITING_FOR_USER',
    });

    // Notify agent runner that we're waiting for user — extends timeout
    eventBus.emit('yuan:event', { kind: 'agent:waiting_for_user', taskId: context.taskId });

    const response = await new Promise<{ value: string; escalatedToChat?: boolean; artifactId?: number }>((resolve) => {
      // Listen for direct reply to this mail card
      const replyHandler = (data: { taskId: string; content: string; messageId?: number; mailId?: number }) => {
        if (data.taskId === context.taskId) {
          // Check if this is a reply to our specific mail card
          if (data.mailId === mailId || !data.mailId) {
            eventBus.off('user:reply', replyHandler);
            eventBus.off('ask-user:escalate', escalateHandler);
            resolve({ value: data.content });
          }
        }
      };

      // Listen for escalation to chat
      const escalateHandler = (data: { mailId: number; taskId: string }) => {
        if (data.mailId === mailId && data.taskId === context.taskId) {
          eventBus.off('user:reply', replyHandler);
          eventBus.off('ask-user:escalate', escalateHandler);
          resolve({ value: '', escalatedToChat: true });
        }
      };

      eventBus.on('user:reply', replyHandler);
      eventBus.on('ask-user:escalate', escalateHandler);
    });

    // If user escalated to chat, delegate to YuanNegotiator
    if (response.escalatedToChat) {
      return this.handleChat(
        `Follow-up from "${originalMode}" interaction`,
        { chatStyle: 'explorer' },
        context,
      );
    }

    return {
      mode: originalMode,
      value: response.value,
      artifactId: response.artifactId,
    };
  }
}
