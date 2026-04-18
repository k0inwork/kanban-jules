export type WorkflowStatus = 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE';
export type AgentState = 'IDLE' | 'EXECUTING' | 'WAITING_FOR_EXECUTOR' | 'WAITING_FOR_USER' | 'PAUSED' | 'ERROR';
export type AutonomyMode = 'manual' | 'assisted' | 'full';

export interface TaskStep {
  id: number;
  title: string;
  description: string;
  executor: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  currentCode?: string;
  executionHistory?: any[];
  seed?: number;
  focus?: string[];
}

export interface ArchitectDecision {
  text: string;
  tags?: string[];
}

export interface TaskProtocol {
  steps: TaskStep[];
  decisions?: ArchitectDecision[];
}

export interface Task {
  id: string;
  title: string;
  description: string;
  workflowStatus: WorkflowStatus;
  agentState: AgentState;
  agentId?: string;
  chat?: string;
  artifactIds?: number[];
  createdAt: number;
  forwardExecutorMessages?: boolean;
  questionCount?: number;
  protocol?: TaskProtocol;
  agentContext?: Record<string, any>;
  pendingExecutorPrompt?: string;
  pendingExecutorId?: string;
  retryCount?: number;
  retryCounts?: Record<string, number>;
  moduleLogs?: Record<string, string>;
  analysis?: string;
  architectModel?: string;
  project?: string; // 'self' | 'target' (default: 'target')
}
