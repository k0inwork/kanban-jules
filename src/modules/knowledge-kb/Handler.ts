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
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
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
      collection = db.kbLog.where('active').equals(params.active ? 1 : 0);
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

  private static async queryDocs(params: any): Promise<KBDoc[]> {
    let results = await db.kbDocs.where('active').equals(1).toArray();
    if (params.project) results = results.filter(d => d.project === params.project);
    if (params.type) results = results.filter(d => d.type === params.type);
    if (params.source) results = results.filter(d => d.source === params.source);
    if (params.layer) results = results.filter(d => d.layer.includes(params.layer));
    if (params.tags && params.tags.length > 0) {
      results = results.filter(d => params.tags.some((t: string) => d.tags.includes(t)));
    }
    results.sort((a, b) => b.timestamp - a.timestamp);
    if (params.limit) results = results.slice(0, params.limit);
    return results;
  }
}
