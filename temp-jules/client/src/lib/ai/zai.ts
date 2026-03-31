import OpenAI from 'openai';
import { executeJulesTool, julesTools } from './tools';
import { ChatMessage } from './gemini';
import { parseHallucinatedToolCalls } from './parseTools';

export class ZAiClient {
  private openai: OpenAI;
  private julesApiKey: string;
  private model: string;

  constructor(apiKey: string, julesApiKey: string, model: string = 'glm-5') {
    this.openai = new OpenAI({
      apiKey,
      baseURL: 'https://api.z.ai/api/coding/paas/v4',
      dangerouslyAllowBrowser: true // This is required for calling OpenAI from the client-side
    });
    this.julesApiKey = julesApiKey;
    this.model = model;
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.openai.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1
      });
      return true;
    } catch {
      return false;
    }
  }

  async sendMessage(messages: ChatMessage[], appendResponse: (msg: string) => void, onDebugPayload?: (payload: { provider: string; request: any; response: any }) => void): Promise<string> {
    const openaiMessages: any[] = messages.map(m => ({
      role: m.role === 'model' ? 'assistant' : 'user',
      content: m.content
    }));

    try {
      let currentMessages = [...openaiMessages];
      let totalContent = "";

      while (true) {
        const requestPayload = {
          model: this.model,
          messages: currentMessages,
          tools: julesTools as any,
          tool_choice: 'auto' as const
        };

        const response = await this.openai.chat.completions.create(requestPayload);

        if (onDebugPayload) {
          onDebugPayload({
            provider: 'zai',
            request: requestPayload,
            response: response
          });
        }

        const choice = response.choices[0];
        const message = choice.message;
        let finalContent = message.content || "";

        // Check for hallucinated tool calls
        const { cleanText, toolCalls: parsedToolCalls } = parseHallucinatedToolCalls(finalContent);
        finalContent = cleanText;

        if (finalContent) {
          totalContent += (totalContent ? "\n\n" : "") + finalContent;
        }

        const allToolCalls = [
          ...(message.tool_calls || []),
          ...parsedToolCalls
        ];

        if (allToolCalls.length === 0) {
          break; // No more tool calls, we are done
        }

        const toolResponses: any[] = [];

        // Ensure message content is a string
        const clonedMessage = { ...message, content: finalContent, tool_calls: allToolCalls };
        currentMessages.push(clonedMessage);

        for (const toolCall of allToolCalls) {
          const fnName = (toolCall as any).function.name;
          const fnArgs = JSON.parse((toolCall as any).function.arguments);

          appendResponse(`\n*Calling tool ${fnName}...*\n`);

          try {
            const result = await executeJulesTool(this.julesApiKey, fnName, fnArgs);
            appendResponse(`*Tool ${fnName} completed successfully.*\n`);
            toolResponses.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(result)
            });
          } catch (e: any) {
            appendResponse(`*Tool ${fnName} failed: ${e.message}*\n`);
            toolResponses.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Error: ${e.message}`
            });
          }
        }

        currentMessages.push(...toolResponses);
      }

      return totalContent;
    } catch (e: any) {
      console.error(e);
      throw e;
    }
  }
}