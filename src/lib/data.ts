import { Task } from '../types';

export const initialTasks: Task[] = [
  {
    id: 'task-list-preview',
    title: 'List and Preview Files',
    description: 'List all files in the repository, read the first 3 lines of each file, present the previews to the user as an artifact, and ask the user to select which files they are interested in.',
    workflowStatus: 'TODO',
    agentState: 'IDLE',
    createdAt: Date.now(),
    moduleLogs: {
      'orchestrator': '> [System] Task created from user request.\n'
    }
  }
];
