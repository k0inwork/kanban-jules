import { GeminiClient, ChatMessage } from './gemini';
import { ZAiClient } from './zai';
import { executeJulesTool, julesTools } from './tools';

export type AIProvider = 'gemini' | 'zai';

export interface AIChatMessage {
  id: string;
  role: 'user' | 'model';
  content: string;
}

export class AIClient {
  private provider: AIProvider;
  private julesApiKey: string;
  private geminiKey: string;
  private zaiKey: string;
  private geminiModel: string;
  private zaiModel: string;

  constructor(provider: AIProvider, julesApiKey: string, geminiKey: string, zaiKey: string, geminiModel: string, zaiModel: string) {
    this.provider = provider;
    this.julesApiKey = julesApiKey;
    this.geminiKey = geminiKey;
    this.zaiKey = zaiKey;
    this.geminiModel = geminiModel;
    this.zaiModel = zaiModel;
  }

  setProvider(provider: AIProvider) {
    this.provider = provider;
  }

  async sendMessage(messages: AIChatMessage[], appendResponse: (msg: string) => void, onDebugPayload?: (payload: { provider: string; request: any; response: any }) => void): Promise<string> {
    const rawMessages: ChatMessage[] = messages.map(m => ({
      role: m.role,
      content: m.content
    }));

    if (this.provider === 'gemini') {
      const client = new GeminiClient(this.geminiKey, this.julesApiKey, this.geminiModel);
      return await client.sendMessage(rawMessages, appendResponse, onDebugPayload);
    } else {
      const client = new ZAiClient(this.zaiKey, this.julesApiKey, this.zaiModel);
      return await client.sendMessage(rawMessages, appendResponse, onDebugPayload);
    }
  }
}
