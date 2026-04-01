import { GoogleGenAI } from "@google/genai";

export interface Tool {
  name: string;
  description: string;
}

export type ExecutionLocation = 'local' | 'jules';

export async function routeTask(
  ai: GoogleGenAI,
  taskTitle: string,
  taskDescription: string,
  localTools: Tool[]
): Promise<ExecutionLocation> {
  const toolsList = localTools.map(t => `- ${t.name}: ${t.description}`).join('\n    ');

  const prompt = `
    You are an intelligent task routing assistant. You must decide whether a task should be executed by the 'local' agent or the 'jules' agent.
    
    LOCAL AGENT CAPABILITIES:
    The local agent is a lightweight environment. It CANNOT execute shell commands, run code, or modify files.
    It ONLY has access to the following specific tools:
    ${toolsList}
    
    JULES AGENT CAPABILITIES:
    - Full development environment.
    - Can write/modify code, refactor, and commit.
    - Can run terminal commands (e.g., grep, wc, npm test, python), execute tests, install dependencies.
    
    Task Title: ${taskTitle}
    Task Description: ${taskDescription}
    
    ROUTING RULES:
    1. If the task can be fully completed using ONLY the specific tools listed for the Local Agent, return LOCAL.
    2. If the task requires modifying code, running tests, executing shell commands (like counting lines of code across a repo), or doing anything beyond the strict capabilities of the local tools, you MUST return JULES.
    
    Return EXACTLY ONE WORD: either "LOCAL" or "JULES". Do not include any other text.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
  });

  const decision = response.text?.trim().toUpperCase() || 'JULES';
  return decision.includes('LOCAL') ? 'local' : 'jules';
}
