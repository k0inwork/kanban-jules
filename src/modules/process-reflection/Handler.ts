import { db } from '../../services/db';
import { RequestContext } from '../../core/types';
import { applyRules } from './rules';

export class ReflectionHandler {
  static async handleRequest(toolName: string, args: any[], context: RequestContext): Promise<any> {
    if (toolName === 'process-reflection.reclassify') {
      return ReflectionHandler.reclassify(args[0] || {});
    }
    throw new Error(`Unknown tool: ${toolName}`);
  }

  private static async reclassify(params: { entryIds?: number[] }): Promise<any> {
    // Gather error entries
    let errors = await db.kbLog.filter(e => e.active).toArray();
    errors = errors.filter(e => e.category === 'error' && e.project === 'target' && e.source === 'execution');

    if (params.entryIds && params.entryIds.length > 0) {
      const idSet = new Set(params.entryIds);
      errors = errors.filter(e => idSet.has(e.id!));
    }

    if (errors.length === 0) {
      return { reclassified: 0, results: [] };
    }

    // Get all entries for cross-referencing
    const allEntries = await db.kbLog.filter(e => e.active).toArray();

    // Apply reflection rules
    const results = applyRules(errors, allEntries);

    // Process results
    const reclassifiedIds: number[] = [];
    for (const result of results) {
      if (!result.match) continue;

      if (result.ruleName === 'KNOWN-GAP') {
        // Don't reclassify — just tag
        await db.kbLog.bulkPut(
          result.entryIds.map(id => {
            const entry = errors.find(e => e.id === id);
            return entry ? { ...entry, tags: [...entry.tags, 'gap-confirmed'] } : null;
          }).filter(Boolean) as any[]
        );
        continue;
      }

      // Reclassify to project='self'
      for (const id of result.entryIds) {
        await db.kbLog.update(id, { project: 'self' });
        reclassifiedIds.push(id);
      }

      // Append reflection entry
      await db.kbLog.add({
        timestamp: Date.now(),
        text: `[reflection] Reclassified ${result.entryIds.length} errors as self-errors. Rule: ${result.ruleName}. ${result.diagnosis}`,
        category: 'correction',
        abstraction: 6,
        layer: ['L0'],
        tags: ['reflection', result.ruleName.toLowerCase().replace(/\s+/g, '-')],
        source: 'dream:session',
        active: true,
        project: 'self'
      });

      // Create self-task if flagged
      if (result.createSelfTask && result.taskTitle) {
        await db.tasks.add({
          id: `self-${Date.now()}`,
          title: result.taskTitle,
          description: result.taskDescription || result.diagnosis,
          workflowStatus: 'TODO',
          agentState: 'IDLE',
          createdAt: Date.now(),
          project: 'self'
        });
      }
    }

    return { reclassified: reclassifiedIds.length, results };
  }
}
