import { db, YuanHistory } from '../services/db';

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
    this.loadFromDB();
  }

  setSystemPrompt(prompt: string) {
    this.systemPrompt = prompt;
  }

  add(msg: ChatMessage) {
    this.history.push(msg);
  }

  /** Build the message list for an LLM call: system prompt + trimmed history + new user message */
  buildMessages(incomingMessage: string): ChatMessage[] {
    const messages: ChatMessage[] = [
      { role: 'system', content: this.systemPrompt },
    ];

    const trimmed = this.history.slice(-this.maxMessages);
    messages.push(...trimmed);
    messages.push({ role: 'user', content: incomingMessage });

    return messages;
  }

  /** Called after a successful run — save assistant response to history + persist to IDB */
  async recordExchange(userMessage: string, assistantResponse: string) {
    this.history.push({ role: 'user', content: userMessage });
    this.history.push({ role: 'assistant', content: assistantResponse });
    this.trim();

    const now = Date.now();
    await db.yuanHistory.bulkAdd([
      { role: 'user', content: userMessage, timestamp: now },
      { role: 'assistant', content: assistantResponse, timestamp: now + 1 },
    ]);
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

  /** Clear in-memory history */
  clear() {
    this.history = [];
  }

  /** Load recent history from IDB on startup */
  private async loadFromDB() {
    try {
      const rows = await db.yuanHistory.orderBy('id').reverse().limit(this.maxMessages).toArray();
      rows.reverse();
      this.history = rows.map(r => ({ role: r.role, content: r.content }));
    } catch {
      // DB might not exist yet (first run)
    }
  }

  /** Reload from DB (e.g. after page reload) */
  async reload() {
    await this.loadFromDB();
  }
}

/**
 * Keyword search over Yuan conversation history.
 * Returns matching chunks with ±CONTEXT_LINES lines of context.
 */
export async function conversationSearch(query: string, limit: number = 5): Promise<string> {
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  if (words.length === 0) return 'No search terms provided.';

  const allRows = await db.yuanHistory.orderBy('timestamp').toArray();
  if (allRows.length === 0) return 'No conversation history found.';

  const CONTEXT_LINES = 5;
  const lines: { idx: number; text: string; score: number }[] = [];

  // Flatten to lines with index
  for (let i = 0; i < allRows.length; i++) {
    const row = allRows[i];
    const lower = row.content.toLowerCase();
    let score = 0;
    for (const word of words) {
      const count = lower.split(word).length - 1;
      score += count;
    }
    if (score > 0) {
      lines.push({ idx: i, text: `[${row.role}] ${row.content}`, score });
    }
  }

  if (lines.length === 0) return `No matches for "${query}".`;

  // Sort by score descending, take top matches
  lines.sort((a, b) => b.score - a.score);
  const topMatches = lines.slice(0, limit);

  // Build result with context
  const results: string[] = [];
  const seenRanges = new Set<number>();

  for (const match of topMatches) {
    const start = Math.max(0, match.idx - CONTEXT_LINES);
    const end = Math.min(allRows.length - 1, match.idx + CONTEXT_LINES);

    const chunk: string[] = [];
    for (let i = start; i <= end; i++) {
      if (!seenRanges.has(i)) {
        seenRanges.add(i);
        chunk.push(`[${allRows[i].role}] ${allRows[i].content}`);
      }
    }
    results.push(chunk.join('\n---\n'));
  }

  return results.join('\n\n--- CHUNK ---\n\n');
}

/** Singleton — persists across Yuan runs */
export const yuanContext = new YuanContext();
