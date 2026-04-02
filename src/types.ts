export type TaskStatus = 'INITIATED' | 'WORKING' | 'PAUSED' | 'POLLING' | 'REVIEW' | 'DONE';
export type AutonomyMode = 'manual' | 'assisted' | 'full';

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  agentId?: string;
  logs?: string;
  chat?: string;
  artifactIds?: number[];
  createdAt: number;
  forwardJulesMessages?: boolean;
}
