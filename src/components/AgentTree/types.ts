export type NodeState = 'idle' | 'running' | 'pending' | 'completed' | 'error' | 'waiting';

export type NodeType = 'task' | 'phase' | 'step' | 'tool' | 'executor' | 'negotiator' | 'projector';

export interface AgentTreeNode {
  id: string;
  type: NodeType;
  name: string;
  state: NodeState;
  detail?: string;
  children: AgentTreeNode[];
  timestamp: number;
  durationMs?: number;
  logs?: string[];
}

export interface AgentTreeState {
  /** Active task trees keyed by task ID */
  tasks: Map<string, AgentTreeNode>;
  /** Active task IDs in order */
  taskOrder: string[];
}
