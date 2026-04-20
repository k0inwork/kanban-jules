import { AgentMessage, AgentId, AgentMessageType } from './agent-message';
import { eventBus } from './event-bus';
import { messageQueue } from './message-queue';
import { RequestContext } from './types';

/**
 * Agent bus — the bridge between eventBus and MessageQueue.
 *
 * In-process agents can import messageQueue directly.
 * Sandbox agents use the `core-agent-bus.sendMessage` tool binding
 * which routes through moduleRequest → registry → here.
 */
export const AgentBus = {
  /**
   * Send a message from any agent (in-process or sandbox).
   * Emits on eventBus AND delivers to the queue.
   */
  send(msg: Omit<AgentMessage, 'id' | 'timestamp'>): AgentMessage {
    const full: AgentMessage = {
      ...msg,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    };
    eventBus.emit('agent:message' as any, full);
    messageQueue.deliver(full);
    return full;
  },

  /**
   * Tool handler for sandbox agents.
   * Binding: 'agent.sendMessage' → 'core-agent-bus.sendMessage'
   *
   * Args: { to, type, payload, taskId?, replyTo? }
   * 'from' is derived from context.
   */
  handleRequest: async (toolName: string, args: any[], context: RequestContext): Promise<string> => {
    const obj = args[0] || {};
    console.log('[AgentBus] handleRequest called:', JSON.stringify(obj).substring(0, 200));
    const msg = AgentBus.send({
      from: (obj.from as AgentId) || 'orchestrator',
      to: obj.to as AgentId | 'broadcast',
      type: obj.type as AgentMessageType,
      payload: obj.payload,
      taskId: obj.taskId || context.taskId,
      replyTo: obj.replyTo,
    });
    return `Message sent: ${msg.id} → ${msg.to} (${msg.type})`;
  },
};
