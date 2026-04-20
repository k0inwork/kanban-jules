import { AgentMessage, AgentId, ALL_AGENT_IDS } from './agent-message';

export class MessageQueue {
  private queues: Map<AgentId, AgentMessage[]> = new Map();

  deliver(msg: AgentMessage): void {
    if (msg.to === 'broadcast') {
      for (const id of ALL_AGENT_IDS) {
        if (id !== msg.from) this.getQueue(id).push(msg);
      }
    } else {
      this.getQueue(msg.to).push(msg);
    }
  }

  poll(agentId: AgentId): AgentMessage | undefined {
    return this.getQueue(agentId).shift();
  }

  peek(agentId: AgentId): AgentMessage | undefined {
    return this.getQueue(agentId)[0];
  }

  pending(agentId: AgentId): number {
    return this.getQueue(agentId).length;
  }

  private getQueue(id: AgentId): AgentMessage[] {
    if (!this.queues.has(id)) this.queues.set(id, []);
    return this.queues.get(id)!;
  }
}

export const messageQueue = new MessageQueue();
