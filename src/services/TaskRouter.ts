export type TaskType = 'analyze' | 'refactor' | 'unit test' | 'unknown';

export type ExecutionLocation = 'local' | 'jules';

export function inferTaskType(title: string, description: string): TaskType {
  const content = (title + ' ' + description).toLowerCase();
  if (content.includes('analyze')) return 'analyze';
  if (content.includes('refactor')) return 'refactor';
  if (content.includes('unit test') || content.includes('test')) return 'unit test';
  return 'unknown';
}

export function getExecutionLocation(taskType: TaskType): ExecutionLocation {
  switch (taskType) {
    case 'analyze':
      return 'local';
    case 'refactor':
    case 'unit test':
      return 'jules';
    default:
      return 'jules'; // Default to Jules for unknown tasks
  }
}
