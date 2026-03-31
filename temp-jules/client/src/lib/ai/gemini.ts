import { GoogleGenAI } from '@google/genai';
import { executeJulesTool, geminiJulesTools } from './tools';
import { parseHallucinatedToolCalls } from './parseTools';

export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
}

const FALLBACK_MODELS = [
  'gemini-3.1-pro-preview',
  'gemini-3.1-flash-lite',
  'gemini-3-pro-preview',
  'gemini-2.5-pro',
  'gemini-2.5-flash'
];

export class GeminiClient {
  private ai: GoogleGenAI;
  private julesApiKey: string;
  private model: string;

  constructor(apiKey: string, julesApiKey: string, model: string = 'gemini-3.1-pro-preview') {
    this.ai = new GoogleGenAI({ apiKey });
    this.julesApiKey = julesApiKey;
    this.model = model;
  }

  async testConnection(): Promise<boolean> {
    const modelsToTry = [this.model, ...FALLBACK_MODELS.filter(m => m !== this.model)];
    for (const model of modelsToTry) {
      try {
        await this.ai.models.generateContent({
          model,
          contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
        });
        return true;
      } catch (e: any) {
        if (e?.status === 429 || e?.message?.includes('quota')) {
          console.warn(`[GeminiClient] Quota exceeded for model ${model}, trying next...`);
          continue;
        }
        // If it's another type of error, we can still try the next model just in case,
        // or return false if we know it's a fatal error like invalid API key.
        // For now, let's keep it simple and try next on any error to be robust.
        console.warn(`[GeminiClient] Error testing model ${model}:`, e);
      }
    }
    return false;
  }

  async sendMessage(messages: ChatMessage[], appendResponse: (msg: string) => void, onDebugPayload?: (payload: { provider: string; request: any; response: any }) => void): Promise<string> {
    // Gemini requires the history to start with a user message
    const filteredMessages = messages[0]?.role === 'model' ? messages.slice(1) : messages;

    const history = filteredMessages.map((m) => ({
      role: m.role,
      parts: [{ text: m.content }],
    }));

    const tools = [{
      functionDeclarations: geminiJulesTools
    }];

    let lastError: any;
    const modelsToTry = [this.model, ...FALLBACK_MODELS.filter(m => m !== this.model)];

    for (const model of modelsToTry) {
      try {
        let currentContents = [...history];
        let totalContent = "";

        while (true) {
          const requestPayload = {
            model,
            contents: currentContents,
            config: {
              tools,
              systemInstruction: 'You are a helpful coding assistant. You can use the Jules API to manage sessions and fix bugs for the user.',
            },
          };

          const response = await this.ai.models.generateContent(requestPayload);

          if (onDebugPayload) {
            onDebugPayload({
              provider: 'gemini',
              request: requestPayload,
              response: response
            });
          }

          let finalContent = "";
          const parts = response.candidates?.[0]?.content?.parts || [];
          const allToolCalls: any[] = [];
          const currentPartsToSave: any[] = [];

          for (const part of parts) {
            if (part.functionCall) {
              allToolCalls.push({
                name: part.functionCall.name || "unknown",
                args: part.functionCall.args,
                originalPart: part
              });
              currentPartsToSave.push(part);
            } else if (part.text) {
              const { cleanText, toolCalls: hallucinatedToolCalls } = parseHallucinatedToolCalls(part.text);
              finalContent += cleanText;
              currentPartsToSave.push({ text: cleanText });

              for (const hCall of hallucinatedToolCalls) {
                allToolCalls.push({
                  name: hCall.function.name,
                  args: JSON.parse(hCall.function.arguments),
                  isHallucinated: true
                });
              }
            }
          }

          if (finalContent) {
            totalContent += (totalContent ? "\n\n" : "") + finalContent;
          }

          if (allToolCalls.length === 0) {
            // Include any fallback text we might have missed
            if (!totalContent && response.text) {
               const { cleanText } = parseHallucinatedToolCalls(response.text);
               totalContent = cleanText;
            }
            break; // No more tool calls, we are done
          }

          // Save model message
          currentContents.push({ role: 'model', parts: currentPartsToSave });

          const toolResponses: any[] = [];

          for (const toolCall of allToolCalls) {
            const fnName = toolCall.name;
            const fnArgs = toolCall.args;

            appendResponse(`\n*Calling tool ${fnName}...*\n`);

            try {
              const result = await executeJulesTool(this.julesApiKey, fnName, fnArgs);
              appendResponse(`*Tool ${fnName} completed successfully.*\n`);
              toolResponses.push({
                functionResponse: { name: fnName, response: result as Record<string, any> }
              });
            } catch (e: any) {
              appendResponse(`*Tool ${fnName} failed: ${e.message}*\n`);
              toolResponses.push({
                functionResponse: { name: fnName, response: { error: e.message } }
              });
            }
          }

          // Save user tool responses
          currentContents.push({ role: 'user', parts: toolResponses });
        }

        return totalContent;

      } catch (e: any) {
        lastError = e;
        if (e?.status === 429 || e?.message?.includes('quota') || e?.message?.includes('429')) {
          const warnMsg = `\n*[GeminiClient] Quota exceeded for model ${model}, trying next...*\n`;
          console.warn(warnMsg);
          appendResponse(warnMsg);
          continue;
        }
        // If it's a completely different error, we should probably still try the next model just in case it's a model-specific issue (like preview model not available).
        const errMsg = `\n*[GeminiClient] Error with model ${model}, trying next...*\n`;
        console.warn(errMsg, e);
        appendResponse(errMsg);
      }
    }

    console.error("[GeminiClient] All fallback models failed. Last error:", lastError);
    throw lastError;
  }
}
