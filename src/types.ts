export type WorkflowStatus = 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE';
export type AgentState = 'IDLE' | 'EXECUTING' | 'WAITING_FOR_JULES' | 'WAITING_FOR_USER' | 'PAUSED' | 'ERROR';
export type AutonomyMode = 'manual' | 'assisted' | 'full';

export interface TaskStep {
  id: number;
  title: string;
  description: string;
  delegateTo: 'local' | 'jules';
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

export interface TaskProtocol {
  steps: TaskStep[];
}

export interface Task {
  id: string;
  title: string;
  description: string;
  workflowStatus: WorkflowStatus;
  agentState: AgentState;
  agentId?: string;
  logs?: string;
  chat?: string;
  artifactIds?: number[];
  createdAt: number;
  forwardJulesMessages?: boolean;
  questionCount?: number;
  actionLog?: string;
  protocol?: TaskProtocol;
  globalVars?: Record<string, any>;
  pendingJulesPrompt?: string;
  retryCount?: number;
  julesRetryCount?: number;
}
