import { GoogleGenAI } from "@google/genai";
import { AgentConfig } from "./LocalAgent";

export interface Tool {
  name: string;
  description: string;
}

export type ExecutionLocation = 'local' | 'jules';

export async function routeTask(
  ai: GoogleGenAI,
  taskTitle: string,
  taskDescription: string,
  localTools: Tool[],
  config: AgentConfig
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

  let responseText = '';
  if (config.apiProvider === 'gemini') {
    const response = await ai.models.generateContent({
      model: config.geminiModel,
      contents: prompt,
    });
    responseText = response.text || '';
  } else {

      let url = `${config.openaiUrl}/chat/completions`;
      let fetchArgs: any = {
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
      };

      if (config.proxyUrl) {
        url = '/api/proxy';
        fetchArgs = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: `${config.openaiUrl}/chat/completions`,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${config.openaiKey}`
            },
            body: {
              model: config.openaiModel,
              messages: [{ role: 'user', content: prompt }],
              temperature: 0.1
            },
            proxyUrl: config.proxyUrl
          })
        };
      }

      const response = await fetch(url, fetchArgs);
      if (response.ok) {
        const data = await response.json();
        const responseData = config.proxyUrl ? data.data : data;
        responseText = responseData.choices[0].message.content || '';
      }

  }

  const decision = responseText.trim().toUpperCase() || 'JULES';
  return decision.includes('LOCAL') ? 'local' : 'jules';
}
