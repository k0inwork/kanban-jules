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

export function composeProgrammerPrompt(modules: ModuleManifest[], task: Task, step: TaskStep, errorContext: string, projectedKnowledge?: string): string {
  const enabledModules = modules.filter(m => m.enabled !== false);
  const executorId = step.executor || 'executor-local';
  const executor = enabledModules.find(m => m.id === executorId);

  const apiSection = Object.entries(executor?.sandboxBindings || {}).map(([alias, toolName]) => {
    const module = enabledModules.find(m => m.tools.some(t => t.name === toolName));
    const tool = module?.tools.find(t => t.name === toolName);
    return `- ${alias}: ${tool?.description || ''}`;
  }).join('\n');

  const commonTools = [
    "- askUser(prompt): Asks the user for input or clarification. Pauses execution until they reply.",
    "- sendUser(message): Sends a message to the user without waiting for a reply. IMPORTANT: Only use for user-facing updates that belong in the mailbox. Do NOT use sendUser() to confirm tool calls or report intermediate results — use addToContext() instead.",
    "- agent.sendMessage({ to, type, payload }): Send a message to another agent (e.g. 'yuan') or 'broadcast'. type: 'info'|'alert'|'proposal'. payload: any object. Use this for inter-agent communication.",
    "- analyze(data, options?): Analyzes the provided data using an LLM and adds the summary to the AgentContext. options: { includeContext?: boolean } (default: true). Set includeContext: false for a 'clean' analysis of only the provided data.",
    "- addToContext(key, value): Directly adds a key-value pair to the AgentContext. If only one argument is provided, it directly appends the data to the context without an LLM call.",
    "- kb.recordEntry({ text, category, abstraction, layer, tags, source }): Record an observation in the knowledge base. Use categories: 'error', 'observation', 'insight', 'decision', 'correction'. abstraction: 0=raw, 5=synthesized, 10=strategic. source: 'execution'. layer: ['L0'].",
    "- kb.queryLog({ category?, tags?, limit? }): Query the knowledge log for past observations, errors, or patterns.",
    "- kb.queryDocs({ type?, tags?, limit? }): Query knowledge documents (specs, designs, references).",
    "- kb.saveDocument({ title, type, content, summary, tags, layer, source }): Save a document to the knowledge base."
  ].join('\n');

  return `
${projectedKnowledge || ''}

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

${errorContext ? `PREVIOUS EXECUTION FAILED:\n${errorContext}\nRewrite the code or use askUser().\n` : ''}

ERROR RECORDING:
When your code catches an error, record it so future executions can learn:
  await kb.recordEntry({ text: "concise description of what went wrong", category: "error", abstraction: 2, layer: ["L2", "L3"], tags: ["${executorId}", "${task.id}"], source: "execution" });

ESCALATION TO USER:
If you are stuck after multiple attempts and cannot resolve the issue, escalate to the user with a structured report:
  await askUser("ESCALATION REPORT:\\nTask: ${task.title}\\nStep: ${step.title}\\nAttempts: N\\nLast Error: <summary>\\nWhat I tried: <list>\\nWhat I need: <specific question or decision>");
  This pauses execution and waits for the user's guidance.
  `;
}

export function composeArchitectPrompt(modules: ModuleManifest[], projectedKnowledge?: string): string {
  const enabledModules = modules.filter(m => m.enabled !== false);
  const executors = enabledModules.filter(m => m.type === 'executor');

  const executorSection = executors.map(e => {
    return `
## Executor ID: "${e.id}"
Name: ${e.name}
Description: ${e.description}
  `}).join('\n---\n');

  return `
${projectedKnowledge || ''}

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
      "status": "pending",
      "focus": ["keyword1", "keyword2"]
    }
  ],
  "decisions": [
    {
      "text": "What you chose and why (include alternatives considered)",
      "tags": ["classification"]
    }
  ]
}
The "focus" array narrows the knowledge context for each step. Include 3-7 specific keywords relevant to what that step needs to know about (e.g., technologies, modules, concepts, file names). Steps with good focus keywords will receive more relevant experience and documentation from the knowledge base.

DECISIONS: List every non-obvious architectural or design decision you made in planning this task.
A decision must have: what was chosen + why (or a clear choice between alternatives).
Do NOT include: following existing patterns, default values, obvious implementations, style choices.
Classification tags must be one of: architectural, api, dependency, pattern, local, infra, security
If no non-obvious decisions were made, output: "decisions": []
  `;
}
