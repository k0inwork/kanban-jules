import { GoogleGenAI } from '@google/genai';
import { TaskProtocol } from '../types';

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

export const generateTaskProtocol = async (
  taskTitle: string,
  taskDescription: string,
  apiProvider: string,
  geminiModel: string,
  openaiUrl: string,
  openaiKey: string,
  openaiModel: string,
  geminiApiKey: string
): Promise<TaskProtocol> => {
  const prompt = `You are a Task Architect. Your job is to break down a task into a strict protocol of steps.
For each step, decide if it should be delegated to 'jules' or 'local'.

JULES CAPABILITIES:
Jules is a highly intelligent remote agent with full access to the repository, CLI, and file system. 
CRITICAL: Do NOT micro-manage Jules with many small, fragmented steps. Jules is capable of handling complex, multi-step instructions in a single turn.
If a task involves searching the codebase, modifying multiple files, and running tests/scripts, GROUP these into a single, ambitious 'jules' step.

DELEGATION RULES:
- 'jules': Use for ALL repository work (CLI, code search, file modifications, running code). Group related repository work into large, comprehensive steps.
- 'local': Use for high-level coordination, API calls to other services, asking the user for input, or simple reasoning that doesn't require repository access.

If a step requires storing state across steps, use 'GlobalVars'. If a step requires creating a persistent artifact for the task (e.g., a generated file or final report), use 'Artifacts' (e.g., 'report.md'). Do not use '_' prefixes for artifacts.

Task Title: ${taskTitle}
Task Description: ${taskDescription}

Output ONLY valid JSON matching this schema:
{
  "steps": [
    {
      "id": 1,
      "title": "Step title",
      "description": "Detailed, comprehensive instructions for the agent. For Jules, provide the full scope of the repository work needed.",
      "executor": "string (e.g., 'executor-jules', 'local')",
      "status": "pending"
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
      return JSON.parse(response.text || '{"steps": []}');
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
        return JSON.parse(data.choices[0].message.content || '{"steps": []}');
      }
    }
  } catch (e) {
    console.error("Failed to generate protocol:", e);
  }
  
  // Fallback protocol
  return {
    steps: [
      {
        id: 1,
        title: "Execute Task",
        description: taskDescription,
        executor: "local",
        status: "pending"
      }
    ]
  };
};
