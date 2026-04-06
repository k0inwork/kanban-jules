import { ModuleManifest } from './types';
import { Task, TaskStep } from '../types';

export function composeProgrammerPrompt(modules: ModuleManifest[], task: Task, step: TaskStep, errorContext: string): string {
  const apiSection = modules.flatMap(m =>
    Object.entries(m.sandboxBindings).map(([alias, toolName]) => {
      const tool = m.tools.find(t => t.name === toolName);
      return `- ${alias}: ${tool?.description || ''}`;
    })
  ).join('\n');

  return `
You are the Main Architect. Write executable JavaScript code to accomplish
the following protocol step.

Task Title: ${task.title}
Task Description: ${task.description}

Current Step: ${step.title}
Step Description: ${step.description}

You have access to a persistent GlobalVars object.
Current GlobalVars: ${JSON.stringify(task.globalVars || {})}

You have access to the following async APIs:
${apiSection}

${errorContext ? `PREVIOUS EXECUTION FAILED:\n${errorContext}\nRewrite the code or use askUser().\n` : ''}

Write ONLY valid JavaScript code. No markdown formatting.
The code runs in an async context. You can use await.
  `;
}

export function composeArchitectPrompt(modules: ModuleManifest[]): string {
  const executors = modules.filter(m => m.type === 'executor');

  const executorSection = executors.map(e => `
## Executor: "${e.name}"
${e.description}
  `).join('\n---\n');

  return `
You are a Task Architect. Break down the task into steps and assign
each step to the best executor.

AVAILABLE EXECUTORS:
${executorSection}

RULES:
- Read each executor's description carefully.
- Assign each step to the executor that fits best.
- Respect each executor's stated granularity preferences.

Output JSON: { steps: [{ id, title, description, executor, status }] }
  `;
}
