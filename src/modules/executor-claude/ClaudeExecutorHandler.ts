import { RequestContext } from '../../core/types';

// DEV-ONLY: executor-claude — delegates subtasks to a local Claude Code agent via server endpoint
// Async: returns immediately with taskId, result injected into yuan's context when ready.
// TODO: gate behind env flag or config. Not for production use.

export interface AsyncTask {
  id: string;
  status: 'pending' | 'done' | 'error';
  result?: any;
  prompt: string;
  startedAt: number;
  finishedAt?: number;
}

// Global registry shared with yuan runner
export const asyncTasks = {
  _tasks: new Map<string, AsyncTask>(),
  _wakeUpTimer: null as ReturnType<typeof setTimeout> | null,

  create(id: string, prompt: string): AsyncTask {
    const task: AsyncTask = { id, status: 'pending', prompt, startedAt: Date.now() };
    this._tasks.set(id, task);
    return task;
  },

  complete(id: string, result: any) {
    const task = this._tasks.get(id);
    if (!task) return;
    task.status = 'done';
    task.result = result;
    task.finishedAt = Date.now();
    console.log(`[async-tasks] Task ${id} completed`);

    // Start 20s wake-up timer — if yuan doesn't make an LLM call, force wake
    this._scheduleWakeUp();
  },

  fail(id: string, error: string) {
    const task = this._tasks.get(id);
    if (!task) return;
    task.status = 'error';
    task.result = { error, exitCode: 1 };
    task.finishedAt = Date.now();
    console.log(`[async-tasks] Task ${id} failed:`, error);

    this._scheduleWakeUp();
  },

  getFinished(): AsyncTask[] {
    const finished: AsyncTask[] = [];
    for (const task of this._tasks.values()) {
      if (task.status === 'done' || task.status === 'error') {
        finished.push(task);
      }
    }
    return finished;
  },

  clearFinished() {
    for (const [id, task] of this._tasks) {
      if (task.status === 'done' || task.status === 'error') {
        this._tasks.delete(id);
      }
    }
  },

  _scheduleWakeUp() {
    if (this._wakeUpTimer) clearTimeout(this._wakeUpTimer);
    this._wakeUpTimer = setTimeout(() => {
      console.log('[async-tasks] 20s passed without LLM call — waking yuan');
      if (typeof globalThis._yuanWakeUp === 'function') {
        globalThis._yuanWakeUp();
      }
      this._wakeUpTimer = null;
    }, 20000);
  },

  cancelWakeUp() {
    if (this._wakeUpTimer) {
      clearTimeout(this._wakeUpTimer);
      this._wakeUpTimer = null;
    }
  },
};

// Expose on globalThis so yuan runner can access it
(globalThis as any)._asyncTasks = asyncTasks;

let _taskCounter = 0;

export class ClaudeExecutorHandler {
  private static _repoRoot: string = '';

  static init(config: any) {
    ClaudeExecutorHandler._repoRoot = config.repoRoot || '';
  }

  async handleRequest(toolName: string, args: any[], context: RequestContext): Promise<any> {
    switch (toolName) {
      case 'executor-claude.run':
        return this.run(args, context);
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  private async run(args: any[], context: RequestContext): Promise<any> {
    const unpack = (arg: any) =>
      arg && typeof arg === 'object' && !Array.isArray(arg) ? arg : null;
    const obj = unpack(args[0]);
    const prompt = obj ? obj.prompt : args[0];

    if (!prompt) {
      return { error: 'prompt is required', exitCode: 1 };
    }

    const taskId = `claude-${++_taskCounter}-${Date.now().toString(36)}`;
    const model = obj?.model || 'sonnet';
    const timeout = Math.min(obj?.timeout || 300000, 600000);

    // Register as async task
    asyncTasks.create(taskId, prompt);

    console.log(`[executor-claude] Starting async task ${taskId}: "${prompt.slice(0, 80)}..."`);

    // Fire-and-forget — run in background
    this.runInBackground(taskId, prompt, model, timeout);

    // Return immediately with task ID
    return {
      taskId,
      status: 'pending',
      message: `Task ${taskId} started on host. Result will arrive automatically.`,
    };
  }

  private async runInBackground(taskId: string, prompt: string, model: string, timeout: number) {
    const body = { prompt, model, timeout };
    try {
      const resp = await fetch('/api/host/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const result = await resp.json();
      asyncTasks.complete(taskId, result);
    } catch (err: any) {
      asyncTasks.fail(taskId, err.message);
    }
  }
}
