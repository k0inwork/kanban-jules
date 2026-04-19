import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── mock eventBus before importing AgentTreeModel ──
const handlers: Record<string, Set<Function>> = {};

vi.mock('../../core/event-bus', () => ({
  eventBus: {
    on: vi.fn((event: string, cb: Function) => {
      if (!handlers[event]) handlers[event] = new Set();
      handlers[event].add(cb);
    }),
    off: vi.fn((event: string, cb: Function) => {
      handlers[event]?.delete(cb);
    }),
    emit: vi.fn((event: string, data: any) => {
      handlers[event]?.forEach(cb => cb(data));
    }),
  },
  // YuanEvent type is just a type export — no runtime value needed
}));

vi.mock('../../services/db', () => ({
  db: {
    tasks: {
      get: vi.fn().mockResolvedValue(undefined),
      toArray: vi.fn().mockResolvedValue([]),
    },
  },
}));

// Stub localStorage
const storage: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: vi.fn((k: string) => storage[k] ?? null),
  setItem: vi.fn((k: string, v: string) => { storage[k] = v; }),
  removeItem: vi.fn((k: string) => { delete storage[k]; }),
  clear: vi.fn(() => Object.keys(storage).forEach(k => delete storage[k])),
});

// Import after mocks are in place
import { AgentTreeModel } from './AgentTreeModel';

let model: AgentTreeModel;

function emit(event: string, data: any) {
  handlers[event]?.forEach(cb => cb(data));
}

beforeEach(() => {
  vi.useFakeTimers();
  // Clear stored handlers between tests
  for (const k of Object.keys(handlers)) delete handlers[k];
  // Clear localStorage so loadFromStorage() starts fresh
  localStorage.clear();
  model = new AgentTreeModel();
});

afterEach(() => {
  model.destroy();
  vi.useRealTimers();
});

// ── Board agent (task pipeline) ──

describe('AgentTreeModel — task pipeline', () => {
  it('creates task root on orchestrator init log', () => {
    emit('module:log', { taskId: 'task-1', moduleId: 'orchestrator', message: 'Initializing Agent Session' });
    const state = model.getState();
    expect(state.tasks.has('task-1')).toBe(true);
    expect(state.taskOrder).toContain('task-1');
    const node = state.tasks.get('task-1')!;
    expect(node.state).toBe('running');
    expect(node.type).toBe('task');
  });

  it('creates step node on "Started Step N" log', () => {
    emit('module:log', { taskId: 'task-1', moduleId: 'orchestrator', message: 'Initializing Agent Session' });
    emit('module:log', { taskId: 'task-1', moduleId: 'orchestrator', message: 'Started Step 1' });

    const task = model.getState().tasks.get('task-1')!;
    expect(task.children.length).toBe(1);
    expect(task.children[0].name).toBe('Step 1');
    expect(task.children[0].state).toBe('running');
  });

  it('creates tool child under current step on module:request', () => {
    emit('module:log', { taskId: 'task-1', moduleId: 'orchestrator', message: 'Initializing Agent Session' });
    emit('module:log', { taskId: 'task-1', moduleId: 'orchestrator', message: 'Started Step 1' });
    emit('module:request', { requestId: 'req-1', taskId: 'task-1', toolName: 'executor-local.runStep', args: [] });

    const task = model.getState().tasks.get('task-1')!;
    const step = task.children.find(c => c.type === 'step')!;
    expect(step.children.length).toBe(1);
    expect(step.children[0].name).toBe('Local: runStep');
    expect(step.children[0].state).toBe('running');
  });

  it('marks tool completed on module:response', () => {
    emit('module:log', { taskId: 'task-1', moduleId: 'orchestrator', message: 'Initializing Agent Session' });
    emit('module:log', { taskId: 'task-1', moduleId: 'orchestrator', message: 'Started Step 1' });
    emit('module:request', { requestId: 'req-1', taskId: 'task-1', toolName: 'executor-local.runStep', args: [] });
    emit('module:response', { requestId: 'req-1', result: { ok: true }, error: undefined });

    const task = model.getState().tasks.get('task-1')!;
    const step = task.children.find(c => c.type === 'step')!;
    expect(step.children[0].state).toBe('completed');
    expect(step.children[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('marks tool error on module:response with error', () => {
    emit('module:log', { taskId: 'task-1', moduleId: 'orchestrator', message: 'Initializing Agent Session' });
    emit('module:log', { taskId: 'task-1', moduleId: 'orchestrator', message: 'Started Step 1' });
    emit('module:request', { requestId: 'req-1', taskId: 'task-1', toolName: 'executor-local.runStep', args: [] });
    emit('module:response', { requestId: 'req-1', result: null, error: 'Something broke' });

    const task = model.getState().tasks.get('task-1')!;
    const step = task.children.find(c => c.type === 'step')!;
    expect(step.children[0].state).toBe('error');
    expect(step.children[0].detail).toContain('Something broke');
  });

  it('creates architect phase node on architect logs', () => {
    emit('module:log', { taskId: 'task-1', moduleId: 'orchestrator', message: 'Initializing Agent Session' });
    emit('module:log', { taskId: 'task-1', moduleId: 'architect', message: 'Generating protocol...' });

    const task = model.getState().tasks.get('task-1')!;
    const arch = task.children.find(c => c.name === 'Architect');
    expect(arch).toBeDefined();
    expect(arch!.state).toBe('running');
  });

  it('marks architect completed when first non-architect tool fires', () => {
    emit('module:log', { taskId: 'task-1', moduleId: 'orchestrator', message: 'Initializing Agent Session' });
    emit('module:log', { taskId: 'task-1', moduleId: 'architect', message: 'Generating protocol...' });
    emit('module:log', { taskId: 'task-1', moduleId: 'orchestrator', message: 'Started Step 1' });
    emit('module:request', { requestId: 'req-1', taskId: 'task-1', toolName: 'executor-local.runStep', args: [] });

    const task = model.getState().tasks.get('task-1')!;
    const arch = task.children.find(c => c.name === 'Architect')!;
    expect(arch.state).toBe('completed');
  });

  it('removes task after executor:completed', () => {
    emit('module:log', { taskId: 'task-1', moduleId: 'orchestrator', message: 'Initializing Agent Session' });
    emit('executor:completed', { taskId: 'task-1', executor: 'executor-local' });

    expect(model.getState().tasks.has('task-1')).toBe(false);
    expect(model.getState().taskOrder).not.toContain('task-1');
  });

  it('ignores system logs (taskId=system)', () => {
    emit('module:log', { taskId: 'system', moduleId: 'orchestrator', message: 'LLM retry' });
    // Only persistent yuan-agent exists, no task created for system logs
    expect(model.getState().tasks.has('task-1')).toBe(false);
    expect(model.getState().tasks.size).toBe(1); // yuan-agent only
  });

  it('ignores module:response with unknown requestId', () => {
    emit('module:response', { requestId: 'unknown', result: true });
    // Should not throw or create any task nodes
    expect(model.getState().tasks.size).toBe(1); // yuan-agent only
  });
});

// ── Yuan agent ──

describe('AgentTreeModel — Yuan agent', () => {
  it('creates Yuan root on agent:thinking', () => {
    emit('yuan:event', { kind: 'agent:thinking', content: 'Analyzing codebase...' });
    const state = model.getState();
    expect(state.tasks.has('yuan-agent')).toBe(true);
    const node = state.tasks.get('yuan-agent')!;
    expect(node.name).toBe('Yuan Agent');
    expect(node.detail).toContain('Analyzing codebase');
    expect(node.state).toBe('running');
  });

  it('adds tool node on agent:tool_call', () => {
    emit('yuan:event', { kind: 'agent:thinking', content: 'Working...' });
    emit('yuan:event', { kind: 'agent:tool_call', tool: 'file_read', args: { path: 'src/main.ts' } });

    const root = model.getState().tasks.get('yuan-agent')!;
    expect(root.children.length).toBe(1);
    expect(root.children[0].name).toBe('file_read');
    expect(root.children[0].state).toBe('running');
    expect(root.children[0].detail).toContain('src/main.ts');
  });

  it('marks tool completed on agent:tool_result', () => {
    emit('yuan:event', { kind: 'agent:thinking', content: 'Working...' });
    emit('yuan:event', { kind: 'agent:tool_call', tool: 'file_read', args: { path: 'src/main.ts' } });
    emit('yuan:event', { kind: 'agent:tool_result', tool: 'file_read', success: true, output: '142 lines' });

    const root = model.getState().tasks.get('yuan-agent')!;
    expect(root.children[0].state).toBe('completed');
    expect(root.children[0].detail).toContain('142 lines');
  });

  it('marks tool error on agent:tool_result with success=false', () => {
    emit('yuan:event', { kind: 'agent:thinking', content: 'Working...' });
    emit('yuan:event', { kind: 'agent:tool_call', tool: 'file_edit', args: { path: 'x' } });
    emit('yuan:event', { kind: 'agent:tool_result', tool: 'file_edit', success: false, output: 'Not found' });

    const root = model.getState().tasks.get('yuan-agent')!;
    expect(root.children[0].state).toBe('error');
  });

  it('removes Yuan root after agent:completed + delay', () => {
    emit('yuan:event', { kind: 'agent:thinking', content: 'Working...' });
    emit('yuan:event', { kind: 'agent:tool_call', tool: 'glob', args: {} });
    emit('yuan:event', { kind: 'agent:completed', summary: 'All done' });

    // Before timer fires
    expect(model.getState().tasks.get('yuan-agent')!.state).toBe('completed');

    // After 2s timer — Yuan resets to idle (persistent node, not removed)
    vi.advanceTimersByTime(2100);
    const yuanNode = model.getState().tasks.get('yuan-agent');
    expect(yuanNode).toBeDefined();
    expect(yuanNode!.state).toBe('idle');
    expect(yuanNode!.children.length).toBe(0);
  });

  it('marks Yuan root error on agent:error', () => {
    emit('yuan:event', { kind: 'agent:thinking', content: 'Working...' });
    emit('yuan:event', { kind: 'agent:tool_call', tool: 'glob', args: {} });
    emit('yuan:event', { kind: 'agent:error', message: 'Rate limited' });

    const root = model.getState().tasks.get('yuan-agent')!;
    expect(root.state).toBe('error');
    expect(root.detail).toContain('Rate limited');
    // Running child also marked error
    expect(root.children[0].state).toBe('error');
  });

  it('handles multiple tool calls sequentially', () => {
    emit('yuan:event', { kind: 'agent:thinking', content: 'Working...' });
    emit('yuan:event', { kind: 'agent:tool_call', tool: 'glob', args: {} });
    emit('yuan:event', { kind: 'agent:tool_result', tool: 'glob', success: true });
    emit('yuan:event', { kind: 'agent:tool_call', tool: 'file_read', args: { path: 'a.ts' } });
    emit('yuan:event', { kind: 'agent:tool_result', tool: 'file_read', success: true });

    const root = model.getState().tasks.get('yuan-agent')!;
    expect(root.children.length).toBe(2);
    expect(root.children[0].state).toBe('completed');
    expect(root.children[1].state).toBe('completed');
  });
});

// ── Persistence ──

describe('AgentTreeModel — persistence', () => {
  it('saves state to localStorage on emit', () => {
    emit('module:log', { taskId: 'task-1', moduleId: 'orchestrator', message: 'Initializing Agent Session' });
    expect(localStorage.setItem).toHaveBeenCalled();
    const saved = localStorage.getItem('agent-tree-state');
    expect(saved).toBeTruthy();
    const parsed = JSON.parse(saved!);
    // yuan-agent (always present) + task-1
    expect(parsed.tasks.length).toBe(2);
    expect(parsed.tasks.find((t: any) => t[0] === 'task-1')).toBeTruthy();
  });

  it('loads state from localStorage on construction', () => {
    // First model saves something
    emit('module:log', { taskId: 'task-1', moduleId: 'orchestrator', message: 'Initializing Agent Session' });
    model.destroy();

    // Second model should load from storage
    const model2 = new AgentTreeModel();
    expect(model2.getState().tasks.has('task-1')).toBe(true);
    model2.destroy();
  });

  it('prunes stale tasks not in provided ID list', async () => {
    emit('module:log', { taskId: 'task-1', moduleId: 'orchestrator', message: 'Initializing Agent Session' });
    emit('module:log', { taskId: 'task-2', moduleId: 'orchestrator', message: 'Initializing Agent Session' });

    // task-1 still exists in DB, task-2 was deleted
    await model.pruneStaleTasks(['task-1', 'yuan-agent']);

    expect(model.getState().tasks.has('task-1')).toBe(true);
    expect(model.getState().tasks.has('task-2')).toBe(false);
  });
});

// ── Subscribe / destroy ──

describe('AgentTreeModel — lifecycle', () => {
  it('notifies subscribers on state change', () => {
    const changes: any[] = [];
    model.subscribe(s => changes.push(s));

    emit('module:log', { taskId: 'task-1', moduleId: 'orchestrator', message: 'Initializing Agent Session' });

    expect(changes.length).toBeGreaterThanOrEqual(1);
    expect(changes[changes.length - 1].tasks.has('task-1')).toBe(true);
  });

  it('stops notifying after unsubscribe', () => {
    const changes: any[] = [];
    const unsub = model.subscribe(s => changes.push(s));
    unsub();

    emit('module:log', { taskId: 'task-1', moduleId: 'orchestrator', message: 'Initializing Agent Session' });

    expect(changes.length).toBe(0);
  });

  it('stops listening to events after destroy', () => {
    model.destroy();
    emit('module:log', { taskId: 'task-1', moduleId: 'orchestrator', message: 'Initializing Agent Session' });

    // No new task created (destroyed model ignores events), only yuan-agent from construction
    expect(model.getState().tasks.has('task-1')).toBe(false);
    expect(model.getState().tasks.size).toBe(1); // yuan-agent only
  });
});
