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

export const externalSources: ExternalKBSource[] = [
  new NotebookLMSource(),
  new WebSearchSource()
];
