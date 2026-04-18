import { db, KBEntry, KBDoc } from '../../services/db';
import { RequestContext } from '../../core/types';

export class KBHandler {
  static async handleRequest(toolName: string, args: any[], context: RequestContext): Promise<any> {
    switch (toolName) {
      case 'knowledge-kb.recordEntry':
        return KBHandler.recordEntry(args[0]);
      case 'knowledge-kb.queryLog':
        return KBHandler.queryLog(args[0]);
      case 'knowledge-kb.updateEntries':
        return KBHandler.updateEntries(args[0]);
      case 'knowledge-kb.saveDocument':
        return KBHandler.saveDocument(args[0]);
      case 'knowledge-kb.queryDocs':
        return KBHandler.queryDocs(args[0]);
      case 'knowledge-kb.updateDocument':
        return KBHandler.updateDocument(args[0]);
      case 'knowledge-kb.deleteDocument':
        return KBHandler.deleteDocument(args[0]);
      case 'knowledge-kb.supersedeEntries':
        return KBHandler.supersedeEntries(args[0]);
      case 'knowledge-kb.traceDecisionChain':
        return KBHandler.traceDecisionChain(args[0]);
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  // Convenience writers (self-healing §3.3)
  static async recordExecution(text: string, tags: string[], project?: string): Promise<number> {
    return KBHandler.recordEntry({ text, category: 'observation', abstraction: 1, layer: ['L1'], tags: [...tags, 'execution'], source: 'execution', project });
  }

  static async recordObservation(text: string, tags: string[], project?: string): Promise<number> {
    return KBHandler.recordEntry({ text, category: 'observation', abstraction: 2, layer: ['L0'], tags, source: 'observation', project });
  }

  static async recordDecision(text: string, tags: string[], project?: string): Promise<number> {
    return KBHandler.recordEntry({ text, category: 'decision', abstraction: 4, layer: ['L0', 'L1'], tags, source: 'decision', project });
  }

  static async recordError(text: string, tags: string[], project?: string): Promise<number> {
    return KBHandler.recordEntry({ text, category: 'error', abstraction: 2, layer: ['L0', 'L1'], tags, source: 'execution', project });
  }

  /**
   * Phase 1e: Supersede entries with chain flattening + abstraction validation.
   * Creates a new entry that replaces the specified entry IDs.
   * - Inherits full supersedes chain from all targets (flattening)
   * - Validates that targets have abstraction <= new entry's abstraction
   * - Deactivates all superseded entries
   */
  static async supersedeEntries(params: {
    text: string;
    category: string;
    abstraction: number;
    layer: string[];
    tags: string[];
    source: string;
    supersedes: number[];
    project?: string;
  }): Promise<{ id: number; deactivated: number }> {
    const { supersedes: targetIds, ...entryParams } = params;

    if (!targetIds || targetIds.length === 0) {
      throw new Error('supersedes must contain at least one entry ID');
    }

    // Fetch all target entries
    const targets = await db.kbLog.bulkGet(targetIds);
    const missingIdx = targets.findIndex(t => t === undefined);
    if (missingIdx !== -1) {
      throw new Error(`Entry ${targetIds[missingIdx]} not found`);
    }

    // Abstraction validation: targets must have abstraction <= new entry
    const validTargets = targets as KBEntry[];
    for (const t of validTargets) {
      if (t.abstraction > params.abstraction) {
        throw new Error(
          `Cannot supersede entry ${t.id} (abstraction ${t.abstraction}) with lower abstraction (${params.abstraction})`
        );
      }
    }

    // Chain flattening: inherit full supersedes chains from all targets
    const inheritedChains = new Set<number>();
    for (const t of validTargets) {
      if (t.id) inheritedChains.add(t.id);
      if (t.supersedes) {
        for (const sid of t.supersedes) {
          inheritedChains.add(sid);
        }
      }
    }

    // Create the new entry with flattened chain
    const newId = await db.kbLog.add({
      timestamp: Date.now(),
      text: entryParams.text,
      category: entryParams.category,
      abstraction: entryParams.abstraction,
      layer: entryParams.layer,
      tags: entryParams.tags || [],
      source: entryParams.source,
      supersedes: [...inheritedChains],
      active: true,
      project: entryParams.project || 'target',
    });

    // Deactivate all superseded entries (direct targets + chain)
    const allDeactivatable = [...inheritedChains];
    if (allDeactivatable.length > 0) {
      await db.kbLog.bulkPut(
        (await db.kbLog.bulkGet(allDeactivatable))
          .filter((e): e is KBEntry => e !== undefined)
          .map(e => ({ ...e, active: false }))
      );
    }

    return { id: newId, deactivated: allDeactivatable.length };
  }

  /**
   * Phase 1e: Trace the full decision chain for an entry.
   * Returns entries ordered from most recent to oldest.
   */
  static async traceDecisionChain(entryId: number): Promise<KBEntry[]> {
    const entry = await db.kbLog.get(entryId);
    if (!entry) return [];

    const chain: KBEntry[] = [entry];
    if (!entry.supersedes || entry.supersedes.length === 0) return chain;

    // Follow supersedes links — already flattened so one hop gets the full chain
    const ancestors = (await db.kbLog.bulkGet(entry.supersedes))
      .filter((e): e is KBEntry => e !== undefined);

    // Sort ancestors by abstraction descending (most abstract/recent first)
    ancestors.sort((a, b) => b.abstraction - a.abstraction || b.timestamp - a.timestamp);
    chain.push(...ancestors);

    return chain;
  }

  private static async recordEntry(params: any): Promise<number> {
    const entry: KBEntry = {
      timestamp: Date.now(),
      text: params.text,
      category: params.category,
      abstraction: params.abstraction,
      layer: params.layer,
      tags: params.tags || [],
      source: params.source,
      supersedes: params.supersedes,
      active: true,
      project: params.project || 'target'
    };
    return db.kbLog.add(entry);
  }

  private static async queryLog(params: any): Promise<KBEntry[]> {
    let collection = db.kbLog.toCollection();
    if (params.active !== undefined) {
      if (params.active) {
        collection = db.kbLog.filter(e => e.active);
      } else {
        collection = db.kbLog.filter(e => !e.active);
      }
    }
    let results = await collection.toArray();
    if (params.project) results = results.filter(e => e.project === params.project);
    if (params.category) results = results.filter(e => e.category === params.category);
    if (params.source) results = results.filter(e => e.source === params.source);
    if (params.layer) results = results.filter(e => e.layer.includes(params.layer));
    if (params.tags && params.tags.length > 0) {
      results = results.filter(e => params.tags.some((t: string) => e.tags.includes(t)));
    }
    results.sort((a, b) => b.abstraction - a.abstraction || b.timestamp - a.timestamp);
    if (params.limit) results = results.slice(0, params.limit);
    return results;
  }

  private static async updateEntries(params: any): Promise<void> {
    const { ids, changes } = params;
    for (const id of ids) {
      await db.kbLog.update(id, changes);
    }
  }

  private static async saveDocument(params: any): Promise<number> {
    // Content is required — documents must have markdown content for chunking
    if (!params.content || typeof params.content !== 'string' || params.content.trim().length === 0) {
      throw new Error('Document content is required and must be non-empty markdown');
    }
    const existing = await db.kbDocs
      .where('title').equals(params.title)
      .and(d => d.project === (params.project || 'target') && d.active)
      .first();

    if (existing) {
      await db.kbDocs.update(existing.id!, {
        ...params,
        version: (existing.version || 1) + 1,
        active: true,
        project: params.project || 'target'
      });
      return existing.id!;
    }

    return db.kbDocs.add({
      timestamp: Date.now(),
      title: params.title,
      type: params.type,
      content: params.content,
      summary: params.summary,
      tags: params.tags || [],
      layer: params.layer,
      source: params.source,
      active: true,
      version: 1,
      project: params.project || 'target'
    });
  }

  private static async updateDocument(params: any): Promise<void> {
    const { id, changes } = params;
    const existing = await db.kbDocs.get(id);
    if (!existing) throw new Error(`Document ${id} not found`);
    await db.kbDocs.update(id, {
      ...changes,
      version: (existing.version || 1) + 1,
    });
  }

  private static async deleteDocument(params: any): Promise<void> {
    const { id } = params;
    await db.kbDocs.update(id, { active: false });
  }

  private static async queryDocs(params: any): Promise<KBDoc[]> {
    let results = await db.kbDocs.filter(d => d.active).toArray();
    if (params.project) results = results.filter(d => d.project === params.project);
    if (params.type) results = results.filter(d => d.type === params.type);
    if (params.source) results = results.filter(d => d.source === params.source);
    if (params.layer) results = results.filter(d => d.layer.includes(params.layer));
    if (params.tags && params.tags.length > 0) {
      results = results.filter(d => params.tags.some((t: string) => d.tags.includes(t)));
    }
    // Full-text search across title, summary, and content
    if (params.search) {
      const q = params.search.toLowerCase();
      results = results.filter(d =>
        d.title.toLowerCase().includes(q) ||
        d.summary.toLowerCase().includes(q) ||
        d.content.toLowerCase().includes(q)
      );
    }
    results.sort((a, b) => b.timestamp - a.timestamp);
    if (params.limit) results = results.slice(0, params.limit);
    return results;
  }
}
