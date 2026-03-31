import { Task } from '../types';

export const initialTasks: Task[] = [
  {
    id: '1',
    title: 'Analyze local repository structure',
    description: 'Use the Agent to read the local directory and identify any exposed secrets or security vulnerabilities in the configuration files.',
    status: 'todo',
    createdAt: Date.now() - 100000,
  },
  {
    id: '2',
    title: 'Refactor authentication module',
    description: 'Instruct Jules to rewrite the auth.ts file to use JWT instead of session cookies. Ensure all tests pass after the refactor.',
    status: 'todo',
    createdAt: Date.now() - 50000,
  },
  {
    id: '3',
    title: 'Write unit tests for Kanban state',
    description: 'Supervise Jules in writing comprehensive Jest unit tests for the task management state logic.',
    status: 'todo',
    createdAt: Date.now(),
  }
];
