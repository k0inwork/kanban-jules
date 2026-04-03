import { GoogleGenAI } from '@google/genai';
import { TaskProtocol } from '../types';

export const generateTaskProtocol = async (
  taskTitle: string,
  taskDescription: string,
  apiProvider: string,
  geminiModel: string,
  openaiUrl: string,
  openaiKey: string,
  openaiModel: string
): Promise<TaskProtocol> => {
  const prompt = `You are a Task Architect. Your job is to break down a task into a strict protocol of steps.
For each step, decide if it should be delegated to 'jules' (for CLI execution, running code, searching the codebase, modifying files) or 'local' (for API calls, asking the user, reading artifacts, or simple reasoning).
CRITICAL: If a task or step is CLI heavy, requires running scripts, or modifying the repository, you MUST send it to 'jules'.
If a step requires creating an internal/local artifact to store state or intermediate results, specify it in the description and ensure its name is prefixed with '_' (e.g., '_analysis.md').

Task Title: ${taskTitle}
Task Description: ${taskDescription}

Output ONLY valid JSON matching this schema:
{
  "steps": [
    {
      "id": 1,
      "title": "Step title",
      "description": "Detailed description of what to do. Mention any _prefixed artifacts to create.",
      "delegateTo": "local" | "jules",
      "status": "pending"
    }
  ]
}`;

  try {
    if (apiProvider === 'gemini') {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
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
        delegateTo: "local",
        status: "pending"
      }
    ]
  };
};
