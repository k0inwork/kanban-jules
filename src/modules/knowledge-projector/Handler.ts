import { db } from '../../services/db';
import { RequestContext } from '../../core/types';
import { ARCHITECT_CONSTITUTION, PROGRAMMER_CONSTITUTION, OVERSEER_CONSTITUTION } from '../../core/constitution';

const BUDGETS: Record<string, { experience: number; rag: number }> = {
  L0: { experience: 4800, rag: 2400 },
  L1: { experience: 3600, rag: 1800 },
  L2: { experience: 3600, rag: 2400 },
  L3: { experience: 2400, rag: 1200 }
};

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'it', 'that', 'this', 'was', 'are',
  'be', 'has', 'had', 'have', 'will', 'would', 'could', 'should', 'may',
  'can', 'do', 'does', 'did', 'not', 'no', 'so', 'if', 'as', 'up', 'out',
  'about', 'into', 'over', 'after', 'then', 'than', 'too', 'very', 'just',
  'also', 'now', 'here', 'there', 'when', 'where', 'how', 'all', 'each',
  'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'only',
  'own', 'same', 'its', 'our', 'we', 'you', 'your', 'they', 'them', 'their',
  'what', 'which', 'who', 'whom', 'these', 'those', 'i', 'me', 'my', 'he',
  'she', 'him', 'her', 'his', 'am', 'been', 'being', 'did', 'get', 'got',
  'make', 'like', 'just', 'know', 'take', 'come', 'want', 'use', 'find',
  'give', 'tell', 'work', 'call', 'try', 'ask', 'need', 'feel', 'become',
  'put', 'add', 'create', 'write', 'new', 'us', 'please', 'task', 'step'
]);

export function extractKeywords(text: string): string[] {
  const words = text.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
  return [...new Set(words)];
}

export interface DocChunk {
  title: string;
  section: string;
  text: string;
  tags: string[];
  type: string;
  timestamp: number;
}

export function chunkDoc(doc: { title: string; content: string; tags: string[]; type: string; timestamp: number }): DocChunk[] {
  const content = doc.content || '';
  // Split by h1 and h2 headers
  const sections = content.split(/^(?=##? )/m).filter(s => s.trim());
  if (sections.length <= 1) {
    // No headers or single section — split by double newline (paragraphs)
    const paras = content.split(/\n\n+/).filter(s => s.trim());
    if (paras.length <= 1) {
      return [{ title: doc.title, section: '', text: content, tags: doc.tags, type: doc.type, timestamp: doc.timestamp }];
    }
    return paras.map((p, i) => ({
      title: doc.title, section: `¶${i + 1}`, text: p.trim(), tags: doc.tags, type: doc.type, timestamp: doc.timestamp
    }));
  }

  // Build chunks with h1 parent context: h2 sections inherit their parent h1 as prefix
  const chunks: DocChunk[] = [];
  let currentH1 = '';
  for (const s of sections) {
    const h1Match = s.match(/^# (.+)/);
    const h2Match = s.match(/^## (.+)/);
    if (h1Match) {
      currentH1 = h1Match[1].trim();
      // h1 itself becomes a chunk (its intro text before any h2)
      chunks.push({ title: doc.title, section: currentH1, text: s.trim(), tags: doc.tags, type: doc.type, timestamp: doc.timestamp });
    } else if (h2Match) {
      const section = currentH1 ? `${currentH1} > ${h2Match[1].trim()}` : h2Match[1].trim();
      chunks.push({ title: doc.title, section, text: s.trim(), tags: doc.tags, type: doc.type, timestamp: doc.timestamp });
    } else {
      chunks.push({ title: doc.title, section: 'intro', text: s.trim(), tags: doc.tags, type: doc.type, timestamp: doc.timestamp });
    }
  }
  return chunks;
}

export function scoreChunk(chunk: DocChunk, keywords: string[], focusKeywords: string[] = []): number {
  const text = `${chunk.title} ${chunk.section} ${chunk.text} ${chunk.tags.join(' ')}`.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    if (text.includes(kw)) score++;
  }
  for (const kw of focusKeywords) {
    if (text.includes(kw)) score += 3;
  }
  // Tag match boost: if any focus keyword matches a tag exactly, big boost
  for (const tag of chunk.tags) {
    if (focusKeywords.includes(tag.toLowerCase())) score += 5;
  }
  return score;
}

function scoreDocByKeywords(doc: { title: string; summary: string; tags: string[] }, keywords: string[], focusKeywords: string[] = []): number {
  const text = `${doc.title} ${doc.summary} ${doc.tags.join(' ')}`.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    if (text.includes(kw)) score++;
  }
  for (const kw of focusKeywords) {
    if (text.includes(kw)) score += 3; // focus keywords get 3x weight
  }
  return score;
}

function scoreEntryByKeywords(entry: { text: string; tags: string[] }, keywords: string[], focusKeywords: string[] = []): number {
  const text = `${entry.text} ${entry.tags.join(' ')}`.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    if (text.includes(kw)) score++;
  }
  for (const kw of focusKeywords) {
    if (text.includes(kw)) score += 3; // focus keywords get 3x weight
  }
  return score;
}

export class ProjectorHandler {
  static async handleRequest(toolName: string, args: any[], context: RequestContext): Promise<any> {
    if (toolName === 'knowledge-projector.project') {
      return ProjectorHandler.project(args[0] || {}, context);
    }
    throw new Error(`Unknown tool: ${toolName}`);
  }

  public static async project(
    params: { layer: string; project?: string; taskId?: string; executor?: string; tags?: string[]; taskDescription?: string; focus?: string[] },
    _context?: RequestContext
  ): Promise<string> {
    const { layer } = params;
    const budget = BUDGETS[layer] || BUDGETS.L3;
    const project = params.project || 'target';
    const keywords = extractKeywords(params.taskDescription || '');
    const focusKeywords = (params.focus || []).map(k => k.toLowerCase());
    const sections: string[] = [];

    // 1. BASE — constitution + role + executor knowledge
    const baseSection = await ProjectorHandler.projectBase(project, layer, params.executor);
    if (baseSection) sections.push(baseSection);

    // 2. RAG — docs scored by keyword relevance to task
    const ragSection = await ProjectorHandler.projectRAG(layer, project, params, budget.rag, keywords, focusKeywords);
    if (ragSection) sections.push(ragSection);

    // 3. EXPERIENCE — log entries filtered by tags/executor, scored by keywords
    const expSection = await ProjectorHandler.projectExperience(layer, project, params, budget.experience, keywords, focusKeywords);
    if (expSection) sections.push(expSection);

    // 4. Board state (L0/L1 only)
    if (layer === 'L0' || layer === 'L1') {
      const boardState = await ProjectorHandler.computeBoardState(project);
      if (boardState) sections.push(boardState);
    }

    // 5. AgentContext (L3 only)
    if (layer === 'L3' && params.taskId) {
      const agentCtx = await ProjectorHandler.getAgentContext(params.taskId);
      if (agentCtx) sections.push(agentCtx);
    }

    return sections.join('\n\n');
  }

  private static async projectBase(project: string, layer: string, executor?: string): Promise<string> {
    const sections: string[] = [];

    const knowledgeRecords = await db.moduleKnowledge.toArray();
    const knowledgeMap: Record<string, string> = {};
    for (const record of knowledgeRecords) {
      knowledgeMap[record.id] = record.content;
    }

    // 1. Project constitution — only for L0/L1 (overseer/project manager)
    if (layer === 'L0' || layer === 'L1') {
      const configs = await db.projectConfigs.toArray();
      if (configs.length > 0 && configs[0].constitution) {
        sections.push(configs[0].constitution);
      }
    }

    // 2. Role constitution (based on layer)
    const roleMap: Record<string, { key: string; fallback: string }> = {
      L0: { key: 'system:yuan', fallback: OVERSEER_CONSTITUTION },
      L1: { key: 'system:overseer', fallback: OVERSEER_CONSTITUTION },
      L2: { key: 'system:architect', fallback: ARCHITECT_CONSTITUTION },
      L3: { key: 'system:programmer', fallback: PROGRAMMER_CONSTITUTION }
    };

    const role = roleMap[layer];
    if (role) {
      const roleConstitution = knowledgeMap[role.key] || role.fallback;
      sections.push(roleConstitution);
    }

    // 3. Executor-specific knowledge
    if (executor && knowledgeMap[executor]) {
      sections.push(`## Executor Knowledge (${executor})\n${knowledgeMap[executor]}`);
    }

    return sections.length > 0 ? `## Base\n${sections.join('\n\n')}` : '';
  }

  private static async projectRAG(layer: string, project: string, opts: any, charBudget: number, keywords: string[], focusKeywords: string[] = []): Promise<string> {
    let docs = await db.kbDocs.filter(d => d.active).toArray();
    docs = docs.filter(d => {
      if (project !== 'all' && d.project !== project) return false;
      if (!d.layer.includes(layer)) return false;
      if (opts.tags && opts.tags.length > 0 && !opts.tags.some((t: string) => d.tags.includes(t))) return false;
      return true;
    });

    // Chunk docs and score per-chunk by keyword overlap + tag boost
    const allChunks: { chunk: DocChunk; score: number }[] = [];
    for (const doc of docs) {
      const chunks = chunkDoc(doc);
      for (const chunk of chunks) {
        allChunks.push({ chunk, score: scoreChunk(chunk, keywords, focusKeywords) });
      }
    }
    allChunks.sort((a, b) => b.score - a.score || b.chunk.timestamp - a.chunk.timestamp);

    const lines: string[] = [];
    let chars = 0;
    for (const { chunk, score } of allChunks) {
      if (score === 0 && lines.length > 0) break;
      const label = chunk.section
        ? `[${chunk.type}] ${chunk.title} > ${chunk.section}`
        : `[${chunk.type}] ${chunk.title}`;
      const line = `${label}:\n${chunk.text}`;
      if (chars + line.length > charBudget) break;
      lines.push(line);
      chars += line.length;
    }
    return lines.length > 0 ? `## Retrieved Knowledge\n${lines.join('\n\n')}` : '';
  }

  private static async projectExperience(layer: string, project: string, opts: any, charBudget: number, keywords: string[], focusKeywords: string[] = []): Promise<string> {
    let entries = await db.kbLog.filter(e => e.active).toArray();
    entries = entries.filter(e => {
      if (project !== 'all' && e.project !== project) return false;
      if (!e.layer.includes(layer)) return false;
      if (opts.executor && !e.tags.includes(opts.executor)) return false;
      if (opts.taskId && !e.tags.includes(opts.taskId)) return false;
      if (opts.tags && opts.tags.length > 0 && !opts.tags.some((t: string) => e.tags.includes(t))) return false;
      // Block: conflict-pending decisions are not projected until resolved
      if (e.tags.includes('conflict-pending')) return false;
      return true;
    });

    // L3/L2: operational needs concrete info — cap abstraction
    // But conflict-resolved decisions bypass the cap: they are settled truths that must cascade
    if (layer === 'L2' || layer === 'L3') {
      entries = entries.filter(e => e.abstraction <= 5 || e.tags.includes('conflict-resolved'));
    }

    // Score by keyword relevance, then sort by score + recency
    const scored = entries.map(e => ({ entry: e, score: scoreEntryByKeywords(e, keywords, focusKeywords) }));
    scored.sort((a, b) => b.score - a.score || b.entry.timestamp - a.entry.timestamp);

    const lines: string[] = [];
    let chars = 0;
    for (const { entry } of scored) {
      const line = `[${entry.category}] ${entry.text}`;
      if (chars + line.length > charBudget) break;
      lines.push(line);
      chars += line.length;
    }
    return lines.length > 0 ? `## Experience\n${lines.join('\n')}` : '';
  }

  private static async computeBoardState(project: string): Promise<string> {
    const tasks = await db.tasks.toArray();
    const filtered = project === 'all' ? tasks : tasks.filter(t => (t.project || 'target') === project);
    const counts: Record<string, number> = {};
    for (const t of filtered) {
      counts[t.workflowStatus] = (counts[t.workflowStatus] || 0) + 1;
    }
    return `## Board: ${filtered.length} tasks (${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ') || 'empty'})`;
  }

  private static async getAgentContext(taskId: string): Promise<string> {
    const task = await db.tasks.get(taskId);
    if (!task?.agentContext || Object.keys(task.agentContext).length === 0) return '';
    return `## AgentContext\n${JSON.stringify(task.agentContext, null, 2)}`;
  }
}
