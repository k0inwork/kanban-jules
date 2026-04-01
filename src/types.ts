export type TaskStatus = 'todo' | 'in-progress' | 'review' | 'done';
export type AutonomyMode = 'manual' | 'assisted' | 'full';

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  agentId?: string;
  logs?: string;
  artifactIds?: number[];
  createdAt: number;
}
