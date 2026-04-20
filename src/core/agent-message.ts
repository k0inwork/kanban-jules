export type AgentId = 'yuan' | 'process-agent' | 'architect' | 'orchestrator' | 'watchdog' | 'user';

export const ALL_AGENT_IDS: AgentId[] = ['yuan', 'process-agent', 'architect', 'orchestrator', 'watchdog', 'user'];

export type AgentMessageType =
  | 'info'
  | 'alert'
  | 'request'
  | 'reply'
  | 'directive'
  | 'proposal'
  | 'status'
  | 'intervention';

export interface AgentMessage {
  id: string;
  from: AgentId;
  to: AgentId | 'broadcast';
  type: AgentMessageType;
  payload: any;
  taskId?: string;
  timestamp: number;
  replyTo?: string;
}
