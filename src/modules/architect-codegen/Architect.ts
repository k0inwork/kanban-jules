import { GoogleGenAI } from '@google/genai';
import { OrchestratorConfig } from '../../core/types';
import { registry } from '../../core/registry';
import { composeArchitectPrompt } from '../../core/prompt';

export class Architect {
  private ai: GoogleGenAI | null = null;
  private config: OrchestratorConfig;

  constructor(config: OrchestratorConfig) {
    this.config = config;
    if (config.apiProvider === 'gemini') {
      this.ai = new GoogleGenAI({ apiKey: config.geminiApiKey || process.env.GEMINI_API_KEY || '' });
    }
  }

  async generateProtocol(title: string, description: string): Promise<any> {
    const prompt = composeArchitectPrompt(registry.getEnabled()) + `\n\nTask Title: ${title}\nTask Description: ${description}`;
    
    let responseText = '';
    if (this.config.apiProvider === 'gemini') {
      if (!this.ai) throw new Error("AI not initialized");
      const response = await this.ai.models.generateContent({
        model: this.config.geminiModel,
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });
      responseText = response.text || '{}';
    } else {
      const response = await fetch(`${this.config.openaiUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.openaiKey}`
        },
        body: JSON.stringify({
          model: this.config.openaiModel,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          response_format: { type: 'json_object' }
        })
      });
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI API error: ${error}`);
      }
      const data = await response.json();
      responseText = data.choices[0].message.content || '{}';
    }
    
    return JSON.parse(responseText);
  }
}

let architectInstance: Architect | null = null;

export const ArchitectTool = {
  init: (config: OrchestratorConfig) => {
    architectInstance = new Architect(config);
  },
  handleRequest: async (toolName: string, args: any[]): Promise<any> => {
    if (!architectInstance) throw new Error("Architect not initialized");
    switch (toolName) {
      case 'architect-codegen.generateProtocol':
        return await architectInstance.generateProtocol(args[0], args[1]);
      default:
        throw new Error(`Tool not found: ${toolName}`);
    }
  }
};
