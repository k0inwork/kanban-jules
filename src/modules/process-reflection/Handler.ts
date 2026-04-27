import { db, SELF_PROJECT_ID } from '../../services/db';
import { RequestContext } from '../../core/types';
import { applyRules } from './rules';

const SELF_TASK_THRESHOLD = 3;

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
    errors = errors.filter(e => e.category === 'error' && e.projectId !== SELF_PROJECT_ID && e.source === 'execution');

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
        for (const id of result.entryIds) {
          const entry = await db.kbLog.get(id);
          if (entry) {
            await db.kbLog.update(id, { tags: [...entry.tags, 'gap-confirmed'] });
          }
        }
        continue;
      }

      // Reclassify to self-project
      for (const id of result.entryIds) {
        await db.kbLog.update(id, { projectId: SELF_PROJECT_ID });
        if (!reclassifiedIds.includes(id)) {
          reclassifiedIds.push(id);
        }
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
        projectId: SELF_PROJECT_ID
      });

      // Send mail to self-project instead of creating task immediately
      if (result.createSelfTask && result.taskTitle) {
        await db.messages.add({
          sender: 'reflection',
          type: 'alert',
          category: 'SIGNAL',
          content: `[${result.ruleName}] ${result.diagnosis}`,
          proposedTask: {
            title: result.taskTitle,
            description: result.taskDescription || result.diagnosis,
          },
          projectId: SELF_PROJECT_ID,
          status: 'unread',
          timestamp: Date.now(),
        });

        // Check if enough mails accumulated for this rule to create a self-task
        const unreadAlerts = await db.messages
          .where('projectId').equals(SELF_PROJECT_ID)
          .filter(m => m.status === 'unread' && m.type === 'alert' && m.sender === 'reflection')
          .toArray();

        // Group by similarity of proposedTask title prefix
        const titlePrefix = result.taskTitle.substring(0, 30);
        const matchingAlerts = unreadAlerts.filter(m =>
          m.proposedTask?.title?.substring(0, 30) === titlePrefix
        );

        if (matchingAlerts.length >= SELF_TASK_THRESHOLD) {
          // Create self-task from the accumulated mails
          await db.tasks.add({
            id: `self-${Date.now()}`,
            title: result.taskTitle,
            description: result.taskDescription || result.diagnosis,
            workflowStatus: 'TODO',
            agentState: 'IDLE',
            createdAt: Date.now(),
            projectId: SELF_PROJECT_ID
          });

          // Mark the mails as read now that a task exists
          for (const mail of matchingAlerts) {
            await db.messages.update(mail.id!, { status: 'read' });
          }
        }
      }
    }

    return { reclassified: reclassifiedIds.length, results };
  }
}
