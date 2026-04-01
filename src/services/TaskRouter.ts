import { GoogleGenAI } from "@google/genai";

export type TaskType = 'analyze' | 'refactor' | 'unit test' | 'unknown';

export interface Tool {
  name: string;
  canHandle: TaskType[];
  description: string;
}

export type ExecutionLocation = 'local' | 'jules';

export function inferTaskType(title: string, description: string): TaskType {
  const content = (title + ' ' + description).toLowerCase();
  if (content.includes('analyze')) return 'analyze';
  if (content.includes('refactor')) return 'refactor';
  if (content.includes('unit test') || content.includes('test')) return 'unit test';
  return 'unknown';
}

export async function assessTaskFeasibility(
  ai: GoogleGenAI,
  taskTitle: string,
  taskDescription: string,
  availableTools: Tool[]
): Promise<number> {
  const prompt = `
    Given the following task and the available local tools, assess the percentage (0-100) 
    of how well we can perform this task locally.
    
    Task Title: ${taskTitle}
    Task Description: ${taskDescription}
    Available Tools: ${JSON.stringify(availableTools)}
    
    Return ONLY the percentage number.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
  });

  const percentage = parseInt(response.text?.trim() || "0", 10);
  return isNaN(percentage) ? 0 : percentage;
}

export function getExecutionLocation(feasibilityScore: number): ExecutionLocation {
  return feasibilityScore >= 80 ? 'local' : 'jules';
}
