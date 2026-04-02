import { GoogleGenAI } from "@google/genai";
import { AgentConfig } from "./LocalAgent";

export interface TaskProtocol {
  objective: string;
  stages: {
    name: string;
    description: string;
    required_artifacts?: string[];
  }[];
  current_stage: string;
  completed_stages: string[];
  data: any;
}

export async function architectTask(
  ai: GoogleGenAI | null,
  taskTitle: string,
  taskDescription: string,
  config: AgentConfig
): Promise<TaskProtocol> {
  const prompt = `
    You are a Task Architect. Your goal is to analyze a Kanban task and generate a structured execution protocol.
    This protocol will be used by a Local Agent to execute the task without "vibing" or guessing.
    
    Task Title: ${taskTitle}
    Task Description: ${taskDescription}
    
    PROJECT CONSTITUTION (Context):
    - The Local Agent can list files, read files, and save artifacts.
    - The Local Agent can delegate complex coding/execution to a remote "Jules" environment.
    - The Local Agent MUST follow the stages you define.
    
    Your output MUST be a JSON object with the following structure:
    {
      "objective": "Clear summary of the task goal",
      "stages": [
        {
          "name": "Stage Name",
          "description": "What needs to be done in this stage",
          "required_artifacts": ["List of artifact names to be produced"]
        }
      ],
      "current_stage": "Name of the first stage",
      "completed_stages": [],
      "data": {}
    }
    
    STAGING RULES:
    1. Break complex tasks into 3-5 logical stages.
    2. Common stages: "Analysis", "Drafting", "Implementation", "Verification".
    3. If the task is simple, 1-2 stages are enough.
    4. Ensure the stages are actionable for an AI agent.
    
    Return ONLY the JSON object. Do not include any other text or markdown formatting.
  `;

  let responseText = '';
  if (config.apiProvider === 'gemini' && ai) {
    const response = await ai.models.generateContent({
      model: config.geminiModel,
      contents: prompt,
    });
    responseText = response.text || '';
  } else {
    const response = await fetch(`${config.openaiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.openaiKey}`
      },
      body: JSON.stringify({
        model: config.openaiModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1
      })
    });
    if (response.ok) {
      const data = await response.json();
      responseText = data.choices[0].message.content || '';
    }
  }

  try {
    // Clean potential markdown formatting
    const jsonStr = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error("Failed to parse architect response:", responseText);
    return {
      objective: taskTitle,
      stages: [{ name: "Execution", description: taskDescription }],
      current_stage: "Execution",
      completed_stages: [],
      data: {}
    };
  }
}
