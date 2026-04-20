/**
 * YuanContext — manages Yuan's conversation history with future compression support.
 *
 * Current: keeps last N messages, trims when over limit.
 * Future: compress older messages into summaries, keep recent verbatim.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  [key: string]: any;
}

const DEFAULT_MAX_MESSAGES = 40;

export class YuanContext {
  private history: ChatMessage[] = [];
  private maxMessages: number;
  private systemPrompt: string = '';

  constructor(maxMessages: number = DEFAULT_MAX_MESSAGES) {
    this.maxMessages = maxMessages;
  }

  setSystemPrompt(prompt: string) {
    this.systemPrompt = prompt;
  }

  add(msg: ChatMessage) {
    this.history.push(msg);
  }

  /** Build the message list for an LLM call: system prompt + trimmed history */
  buildMessages(incomingMessage: string): ChatMessage[] {
    const messages: ChatMessage[] = [
      { role: 'system', content: this.systemPrompt },
    ];

    // Future: compress older history into a summary message here
    // const summary = this.compress(this.history);

    const trimmed = this.history.slice(-this.maxMessages);
    messages.push(...trimmed);
    messages.push({ role: 'user', content: incomingMessage });

    return messages;
  }

  /** Called after a successful run — save assistant response to history */
  recordExchange(userMessage: string, assistantResponse: string) {
    this.history.push({ role: 'user', content: userMessage });
    this.history.push({ role: 'assistant', content: assistantResponse });
    this.trim();
  }

  /** Trim history to maxMessages, keeping system prompt out of the count */
  private trim() {
    if (this.history.length > this.maxMessages * 2) {
      this.history = this.history.slice(-this.maxMessages);
    }
  }

  /** Get raw history (for debugging or migration) */
  getHistory(): ChatMessage[] {
    return [...this.history];
  }

  /** Get current message count */
  get length(): number {
    return this.history.length;
  }

  /** Clear everything */
  clear() {
    this.history = [];
  }

  // --- Future: compression ---
  // private compress(messages: ChatMessage[]): string | null {
  //   // Summarize older messages into a single system message
  //   // Use llmCall to generate summary
  //   return null;
  // }
}

/** Singleton — persists across Yuan runs */
export const yuanContext = new YuanContext();
