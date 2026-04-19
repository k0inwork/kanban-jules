import { db } from '../../services/db';
import { RequestContext } from '../../core/types';

export const TaskLogTool = {
  init: () => {},

  handleRequest: async (toolName: string, args: any[], context: RequestContext): Promise<string> => {
    if (toolName !== 'knowledge-task-logs.getLogs') {
      throw new Error(`Tool not found: ${toolName}`);
    }

    const unpack = (arg: any) => (arg && typeof arg === 'object' && !Array.isArray(arg)) ? arg : null;
    const obj = unpack(args[0]);
    const taskRef = obj?.task || args[0];
    const moduleFilter = obj?.module || args[1];
    const tail = obj?.tail || args[2];

    if (!taskRef) throw new Error('task (ID or name) is required');

    // Look up by ID first, then by title
    let task = await db.tasks.get(taskRef);
    if (!task) {
      const all = await db.tasks.toArray();
      task = all.find(t => t.title && t.title.toLowerCase().includes(taskRef.toLowerCase()));
    }
    if (!task) {
      throw new Error(`Task not found: "${taskRef}"`);
    }

    const moduleLogs = task.moduleLogs || {};
    const modules = Object.keys(moduleLogs).sort();

    if (modules.length === 0) {
      return `No logs for task "${task.title}" (${task.id})`;
    }

    const lines: string[] = [`Task: ${task.title} (${task.id})`, `Status: ${task.workflowStatus}`];

    for (const mod of modules) {
      if (moduleFilter && mod !== moduleFilter) continue;
      let log = moduleLogs[mod] || '';
      if (tail && tail > 0) {
        const logLines = log.split('\n').filter(Boolean);
        log = logLines.slice(-tail).join('\n');
      }
      lines.push(`\n── ${mod} ──\n${log}`);
    }

    return lines.join('\n');
  },
};
