import { ModuleManifest } from './types';
import { Task, TaskStep } from '../types';
import { GoogleGenAI } from '@google/genai';
import { ARCHITECT_CONSTITUTION, PROGRAMMER_CONSTITUTION } from './constitution';

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

export function composeProgrammerPrompt(modules: ModuleManifest[], task: Task, step: TaskStep, errorContext: string, moduleKnowledge: Record<string, string> = {}): string {
  const enabledModules = modules.filter(m => m.enabled !== false);
  const executorId = step.executor || 'executor-local';
  
  // Collect all tools from all enabled modules
  const apiSection = enabledModules.flatMap(m => 
    Object.entries(m.sandboxBindings || {}).map(([alias, toolName]) => {
      const tool = m.tools.find(t => t.name === toolName);
      return `- ${alias}: ${tool?.description || toolName}`;
    })
  ).join('\n');

  const commonTools = [
    "- askUser(prompt): Asks the user for input or clarification. Pauses execution until they reply.",
    "- sendUser(message): Sends a message to the user without waiting for a reply. Use this to report final results.",
    "- analyze(data, options?): Analyzes the provided data using an LLM and adds the summary to the AgentContext. options: { includeContext?: boolean } (default: true). Set includeContext: false for a 'clean' analysis of only the provided data.",
    "- addToContext(key, value): Directly adds a key-value pair to the AgentContext. If only one argument is provided, it directly appends the data to the context without an LLM call."
  ].join('\n');

  const knowledge = moduleKnowledge[executorId] ? `\nMODULE KNOWLEDGE BASE:\n${moduleKnowledge[executorId]}\n` : '';
  let constitution = moduleKnowledge['system:programmer'] || PROGRAMMER_CONSTITUTION;

  if (errorContext) {
    const retryConstitution = moduleKnowledge['system:programmer:retry'] || '';
    if (retryConstitution) {
      constitution = `${constitution}\n\nRETRY CONTEXT:\n${retryConstitution}`;
    }
  }

  return `
${constitution}

TASK CONTEXT:
Task Title: ${task.title}
Task Description: ${task.description}

Current Step: ${step.title}
Step Description: ${step.description}

You have access to a persistent AgentContext object.
Current AgentContext: ${JSON.stringify(task.agentContext || {})}
${task.analysis ? `\nAccumulated Analysis Results:\n${task.analysis}\n` : ''}

AVAILABLE APIS:
${apiSection}
${commonTools}
${knowledge}

${errorContext ? `PREVIOUS EXECUTION FAILED:\n${errorContext}\nRewrite the code or use askUser().\n` : ''}
  `;
}

export function composeArchitectPrompt(modules: ModuleManifest[], moduleKnowledge: Record<string, string> = {}): string {
  const enabledModules = modules.filter(m => m.enabled !== false);
  const executors = enabledModules.filter(m => m.type === 'executor');

  const executorSection = executors.map(e => {
    const knowledge = moduleKnowledge[e.id] ? `\nKnowledge Base:\n${moduleKnowledge[e.id]}` : '';
    return `
## Executor ID: "${e.id}"
Name: ${e.name}
Description: ${e.description}${knowledge}
  `}).join('\n---\n');

  const constitution = moduleKnowledge['system:architect'] || ARCHITECT_CONSTITUTION;

  return `
${constitution}

AVAILABLE EXECUTORS:
${executorSection}

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
