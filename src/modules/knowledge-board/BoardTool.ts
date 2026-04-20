import { db } from '../../services/db';
import { RequestContext } from '../../core/types';
import { Task } from '../../types';
import { sanitizeTaskUpdates } from '../../core/task-guards';

function generateId(): string {
  return Math.random().toString(16).slice(2, 10) + Date.now().toString(36);
}

async function resolveTask(taskRef: string): Promise<Task | undefined> {
  let task = await db.tasks.get(taskRef);
  if (!task) {
    const all = await db.tasks.toArray();
    task = all.find(t => t.title && t.title.toLowerCase().includes(taskRef.toLowerCase()));
  }
  return task;
}

function formatCompact(task: Task): string {
  return `[${task.workflowStatus}] ${task.id} — ${task.title} (agent: ${task.agentState || 'IDLE'})`;
}

export const BoardTool = {
  init: () => {},

  handleRequest: async (toolName: string, args: any[], context: RequestContext): Promise<string> => {
    const unpack = (arg: any) => (arg && typeof arg === 'object' && !Array.isArray(arg)) ? arg : null;

    switch (toolName) {
      case 'knowledge-board.listTasks': {
        const obj = unpack(args[0]) || {};
        let collection = db.tasks.orderBy('createdAt');
        const tasks = await collection.toArray();

        let filtered = tasks.filter(t => (t as any).workflowStatus !== 'ARCHIVED');
        if (obj.status) {
          const status = obj.status.toUpperCase();
          filtered = filtered.filter(t => t.workflowStatus === status);
        }
        if (obj.project) {
          filtered = filtered.filter(t => (t.project || 'target') === obj.project);
        }

        if (filtered.length === 0) {
          return 'No tasks found.';
        }
        return filtered.map(formatCompact).join('\n');
      }

      case 'knowledge-board.getTask': {
        const obj = unpack(args[0]) || {};
        const taskRef = obj.task || args[0];
        if (!taskRef) throw new Error('task (ID or name) is required');

        const task = await resolveTask(taskRef);
        if (!task) throw new Error(`Task not found: "${taskRef}"`);

        return JSON.stringify(task, null, 2);
      }

      case 'knowledge-board.createTask': {
        const obj = unpack(args[0]) || {};
        const title = obj.title || args[0];
        if (!title) throw new Error('title is required');

        const id = generateId();
        const task: Task = {
          id,
          title,
          description: obj.description || args[1] || '',
          workflowStatus: 'TODO',
          agentState: 'IDLE',
          createdAt: Date.now(),
          project: obj.project || 'target',
          moduleLogs: {},
        };

        await db.tasks.add(task);
        return `Created task ${id}: "${title}"`;
      }

      case 'knowledge-board.updateTask': {
        const obj = unpack(args[0]) || {};
        const taskRef = obj.task || args[0];
        const updates = obj.updates || args[1];
        if (!taskRef) throw new Error('task (ID or name) is required');
        if (!updates || typeof updates !== 'object') throw new Error('updates object is required');

        const task = await resolveTask(taskRef);
        if (!task) throw new Error(`Task not found: "${taskRef}"`);

        // Whitelist updatable fields (shared with boardVM.tasks)
        const safe = sanitizeTaskUpdates(updates);

        if (Object.keys(safe).length === 0) {
          return 'No valid fields to update.';
        }

        await db.tasks.update(task.id, safe);
        return `Updated task ${task.id}: ${Object.keys(safe).join(', ')}`;
      }

      case 'knowledge-board.getLogs': {
        const obj = unpack(args[0]);
        const taskRef = obj?.task || args[0];
        const moduleFilter = obj?.module || args[1];
        const tail = obj?.tail || args[2];

        if (!taskRef) throw new Error('task (ID or name) is required');

        const task = await resolveTask(taskRef);
        if (!task) throw new Error(`Task not found: "${taskRef}"`);

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
      }

      default:
        throw new Error(`Tool not found: ${toolName}`);
    }
  },
};
