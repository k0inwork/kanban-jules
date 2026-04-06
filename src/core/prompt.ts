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
  const apiSection = enabledModules.flatMap(m =>
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
  const enabledModules = modules.filter(m => m.enabled !== false);
  const executors = enabledModules.filter(m => m.type === 'executor');

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
