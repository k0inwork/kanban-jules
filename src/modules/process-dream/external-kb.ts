export interface ExternalKBSource {
  query(prompt: string, context: string): Promise<string>;
  available(): boolean;
}

export class NotebookLMSource implements ExternalKBSource {
  async query(_prompt: string, _context: string): Promise<string> {
    throw new Error('NotebookLM not configured');
  }
  available(): boolean { return false; }
}

export class WebSearchSource implements ExternalKBSource {
  async query(_prompt: string, _context: string): Promise<string> {
    throw new Error('Web search not configured');
  }
  available(): boolean { return false; }
}

/**
 * Fixed-knowledge stub for testing. Returns canned responses
 * based on keyword matching. Allows testing the external KB
 * pipeline (F6: Dream → External → kb gap-filling) without
 * real external services.
 */
export class FixedKBSource implements ExternalKBSource {
  private knowledge: Map<string, string>;
  private defaultResponse: string;

  constructor(entries: Record<string, string>, defaultResponse: string = 'No relevant knowledge found.') {
    this.knowledge = new Map(Object.entries(entries));
    this.defaultResponse = defaultResponse;
  }

  available(): boolean { return true; }

  async query(prompt: string, context: string): Promise<string> {
    const combined = `${context} ${prompt}`.toLowerCase();
    const matches: string[] = [];
    for (const [keyword, answer] of this.knowledge) {
      if (combined.includes(keyword.toLowerCase())) {
        matches.push(answer);
      }
    }
    return matches.length > 0 ? matches.join('\n') : this.defaultResponse;
  }
}

export const externalSources: ExternalKBSource[] = [
  new NotebookLMSource(),
  new WebSearchSource()
];

/** Replace external sources (used by tests to inject FixedKBSource) */
export function setExternalSources(sources: ExternalKBSource[]): void {
  externalSources.length = 0;
  externalSources.push(...sources);
}
