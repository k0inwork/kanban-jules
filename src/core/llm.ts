import { GoogleGenAI, GenerateContentResponse } from '@google/genai';
import { HostConfig } from './types';

export async function llmCall(config: HostConfig, prompt: string, jsonMode?: boolean): Promise<string> {
  const maxRetries = 3;
  let lastError: any;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout
      
      try {
        const llmPromise = (async () => {
          if (config.apiProvider === 'gemini') {
            const ai = new GoogleGenAI({ apiKey: config.geminiApiKey || process.env.GEMINI_API_KEY || '' });
            console.log(`[LLM] Call (Gemini): model=${config.geminiModel}`);
            console.log(`[LLM] Prompt:`, prompt);
            const response: GenerateContentResponse = await ai.models.generateContent({
              model: config.geminiModel,
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              config: jsonMode ? { responseMimeType: 'application/json' } : undefined
            });
            return response.text || '';
          } else {
            let url = config.openaiUrl;
            let key = config.openaiKey;
            let model = config.openaiModel;

            if (config.apiProvider !== 'openai-legacy') {
              const provider = config.openaiProviders?.find(p => p.id === config.apiProvider);
              if (provider) {
                url = provider.baseUrl;
                key = provider.apiKey;
                model = provider.model;
              }
            }

            console.log(`[LLM] Call (OpenAI-compatible): url=${url}, model=${model}, jsonMode=${!!jsonMode}`);
            console.log(`[LLM] Prompt:`, prompt);

            const response = await fetch(`${url}/chat/completions`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${key}`
              },
              body: JSON.stringify({
                model: model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.1,
                response_format: jsonMode ? { type: 'json_object' } : undefined
              }),
              signal: controller.signal
            });
            if (response.ok) {
              const data = await response.json();
              const result = data.choices[0].message.content || '';
              if (jsonMode) {
                console.log(`[LLM] Response (JSON):`, result);
              }
              return result;
            } else {
              const error = await response.text();
              console.error(`[LLM] OpenAI API error: status=${response.status}, error=${error}`);
              throw new Error(`OpenAI API error: ${error}`);
            }
          }
        })();

        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('NetworkError: LLM call timed out after 60 seconds')), 60000);
        });

        return await Promise.race([llmPromise, timeoutPromise]);
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error: any) {
      lastError = error;
      const isNetworkError = error.message?.includes('NetworkError') || error.message?.includes('fetch') || error.message?.includes('ECONNREFUSED');
      const isRateLimit = error.message?.includes('429') || error.message?.includes('1302') || error.message?.includes('rate limit') || error.message?.includes('速率限制');
      
      if (!isNetworkError && !isRateLimit) {
        throw error; // Don't retry other errors like 400 Bad Request
      }
      
      if (attempt < maxRetries - 1) {
        const delay = 5000 * (attempt + 1); // 5s, 10s
        console.warn(`[LLM] call failed (attempt ${attempt + 1}/${maxRetries}). Retrying in ${delay}ms... Error: ${error.message}`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}
