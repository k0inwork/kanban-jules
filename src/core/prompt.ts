import { ModuleManifest } from './types';
import { Task, TaskStep } from '../types';
import { GoogleGenAI } from '@google/genai';

export const parseTasksFromMessage = async (
  messageContent: string,
  apiProvider: string,
  geminiModel: string,
  openaiUrl: string,
  openaiKey: string,
  openaiModel: string,
  geminiApiKey: string
): Promise<{ title: string; description: string }[]> => {
  const prompt = `You are a Task Architect. Analyze the following message and extract one or more concrete software tasks.
A task should be a specific, actionable piece of work.
If the message contains multiple distinct requests, break them into separate tasks.
If the message is a single request, return it as one task.

Message Content:
${messageContent}

Output ONLY valid JSON matching this schema:
{
  "tasks": [
    {
      "title": "Short, descriptive title",
      "description": "Detailed instructions for the task"
    }
  ]
}`;

  try {
    if (apiProvider === 'gemini') {
      const ai = new GoogleGenAI({ apiKey: geminiApiKey || process.env.GEMINI_API_KEY || '' });
      const response = await ai.models.generateContent({
        model: geminiModel,
        contents: prompt,
        config: {
          responseMimeType: 'application/json'
        }
      });
      const data = JSON.parse(response.text || '{"tasks": []}');
      return data.tasks || [];
    } else {
      const response = await fetch(`${openaiUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`
        },
        body: JSON.stringify({
          model: openaiModel,
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          temperature: 0.1
        })
      });
      if (response.ok) {
        const data = await response.json();
        const parsed = JSON.parse(data.choices[0].message.content || '{"tasks": []}');
        return parsed.tasks || [];
      }
    }
  } catch (e) {
    console.error("Failed to parse tasks from message:", e);
  }
  
  // Fallback: return the original message as a single task
  return [{
    title: "Task from Mailbox",
    description: messageContent
  }];
};

export function composeProgrammerPrompt(modules: ModuleManifest[], task: Task, step: TaskStep, errorContext: string): string {
  const enabledModules = modules.filter(m => m.enabled !== false);
  const executorId = step.executor || 'executor-local';
  const executor = enabledModules.find(m => m.id === executorId);
  
  const apiSection = Object.entries(executor?.sandboxBindings || {}).map(([alias, toolName]) => {
    const module = enabledModules.find(m => m.tools.some(t => t.name === toolName));
    const tool = module?.tools.find(t => t.name === toolName);
    return `- ${alias}: ${tool?.description || ''}`;
  }).join('\n');

  const commonTools = [
    "- askUser(prompt): Asks the user for input or clarification.",
    "- analyze(data): Sends data to the host for analysis (e.g., code analysis, log analysis).",
    "- addToContext(key, value): Adds data to the task context for future steps."
  ].join('\n');

  return `
You are the Programmer Agent. Write executable JavaScript code to accomplish
the following protocol step.

Task Title: ${task.title}
Task Description: ${task.description}

Current Step: ${step.title}
Step Description: ${step.description}

You have access to a persistent GlobalVars object.
Current GlobalVars: ${JSON.stringify(task.globalVars || {})}

You have access to the following async APIs (injected into your scope):
${apiSection}
${commonTools}

${errorContext ? `PREVIOUS EXECUTION FAILED:\n${errorContext}\nRewrite the code or use askUser().\n` : ''}

RULES:
- Write ONLY valid JavaScript code.
- No markdown formatting (no \`\`\` blocks).
- The code runs in an async context. You can use await.
- Use GlobalVars to store state between steps if needed.
- If you need user input, use askUser(prompt).
- If you are using executor-github, you must first runWorkflow, then poll getRunStatus, then fetchArtifacts.
  `;
}

export function composeArchitectPrompt(modules: ModuleManifest[]): string {
  const enabledModules = modules.filter(m => m.enabled !== false);
  const executors = enabledModules.filter(m => m.type === 'executor');

  const executorSection = executors.map(e => `
## Executor ID: "${e.id}"
Name: ${e.name}
Description: ${e.description}
  `).join('\n---\n');

  return `
You are a Task Architect. Break down the task into steps and assign
each step to the best executor.

AVAILABLE EXECUTORS:
${executorSection}

RULES:
- Read each executor's description carefully.
- Assign each step to the executor that fits best by using its "Executor ID".
- Respect each executor's stated granularity preferences.
- "executor-local" is best for small, tool-based tasks (file read/write, artifact creation).
- "executor-jules" is best for large, ambitious coding tasks in a remote VM.
- "executor-github" is best for heavy compute, CI/CD, or long-running processes.

Output ONLY valid JSON matching this schema:
{
  "steps": [
    {
      "id": number,
      "title": "Short title",
      "description": "Detailed instructions",
      "executor": "The Executor ID (e.g., 'executor-local')",
      "status": "pending"
    }
  ]
}
  `;
}
