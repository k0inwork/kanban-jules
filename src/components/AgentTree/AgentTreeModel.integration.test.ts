/**
 * Integration test — uses the REAL eventBus (no mocks) to verify
 * that yuan events emitted via eventBus reach AgentTreeModel.
 *
 * This tests the same path that agent-bootstrap uses:
 *   eventBus.emit('yuan:event', { kind: 'agent:tool_call', ... })
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock only DB (not eventBus — we want real event propagation)
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

// Import REAL eventBus and model (after mocks)
import { eventBus } from '../../core/event-bus';
import { AgentTreeModel } from './AgentTreeModel';

let model: AgentTreeModel;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  model = new AgentTreeModel();
});

afterEach(() => {
  model.destroy();
  vi.useRealTimers();
});

describe('AgentTreeModel — real eventBus integration', () => {
  it('receives yuan:thinking via real eventBus', () => {
    eventBus.emit('yuan:event', { kind: 'agent:thinking', content: 'Analyzing codebase...' });

    const state = model.getState();
    expect(state.tasks.has('yuan-agent')).toBe(true);
    const node = state.tasks.get('yuan-agent')!;
    expect(node.state).toBe('running');
    expect(node.detail).toContain('Analyzing codebase');
  });

  it('accumulates tool calls via real eventBus', () => {
    eventBus.emit('yuan:event', { kind: 'agent:thinking', content: 'Working...' });
    eventBus.emit('yuan:event', { kind: 'agent:tool_call', tool: 'file_read', args: { path: 'src/main.ts' } });
    eventBus.emit('yuan:event', { kind: 'agent:tool_result', tool: 'file_read', success: true, output: '142 lines' });
    eventBus.emit('yuan:event', { kind: 'agent:tool_call', tool: 'glob', args: { pattern: '**/*.ts' } });

    const root = model.getState().tasks.get('yuan-agent')!;
    expect(root.children.length).toBe(2);
    expect(root.children[0].name).toBe('file_read');
    expect(root.children[0].state).toBe('completed');
    expect(root.children[1].name).toBe('glob');
    expect(root.children[1].state).toBe('running');
  });

  it('stays green after completed via real eventBus', () => {
    eventBus.emit('yuan:event', { kind: 'agent:thinking', content: 'Working...' });
    eventBus.emit('yuan:event', { kind: 'agent:tool_call', tool: 'glob', args: {} });
    eventBus.emit('yuan:event', { kind: 'agent:completed', summary: 'All done' });

    const root = model.getState().tasks.get('yuan-agent')!;
    expect(root.state).toBe('completed');
    expect(root.children.length).toBe(1);
  });

  it('clears children on agent:start via real eventBus', () => {
    eventBus.emit('yuan:event', { kind: 'agent:thinking', content: 'Working...' });
    eventBus.emit('yuan:event', { kind: 'agent:tool_call', tool: 'glob', args: {} });
    eventBus.emit('yuan:event', { kind: 'agent:completed', summary: 'Done' });

    // Tools still visible
    expect(model.getState().tasks.get('yuan-agent')!.children.length).toBe(1);

    // New message clears them
    eventBus.emit('yuan:event', { kind: 'agent:start', goal: 'New task' });
    expect(model.getState().tasks.get('yuan-agent')!.children.length).toBe(0);
    expect(model.getState().tasks.get('yuan-agent')!.state).toBe('running');
  });

  it('preserves tools across multiple thinking events via real eventBus', () => {
    eventBus.emit('yuan:event', { kind: 'agent:thinking', content: 'Step 1...' });
    eventBus.emit('yuan:event', { kind: 'agent:tool_call', tool: 'glob', args: {} });
    eventBus.emit('yuan:event', { kind: 'agent:tool_result', tool: 'glob', success: true });
    // Second thinking — tools must persist
    eventBus.emit('yuan:event', { kind: 'agent:thinking', content: 'Step 2...' });
    eventBus.emit('yuan:event', { kind: 'agent:tool_call', tool: 'file_read', args: { path: 'x.ts' } });

    const root = model.getState().tasks.get('yuan-agent')!;
    expect(root.children.length).toBe(2);
    expect(root.children[0].name).toBe('glob');
    expect(root.children[1].name).toBe('file_read');
  });

  it('receives board task pipeline events via real eventBus', () => {
    eventBus.emit('module:log', { taskId: 'task-1', moduleId: 'orchestrator', message: 'Initializing Agent Session' });
    eventBus.emit('module:log', { taskId: 'task-1', moduleId: 'orchestrator', message: 'Started Step 1' });
    eventBus.emit('module:request', { requestId: 'req-1', taskId: 'task-1', toolName: 'executor-local.runStep', args: [] });
    eventBus.emit('module:response', { requestId: 'req-1', result: { ok: true }, error: undefined });

    const task = model.getState().tasks.get('task-1')!;
    expect(task).toBeDefined();
    expect(task.state).toBe('running');
    const step = task.children.find(c => c.type === 'step')!;
    expect(step.children[0].state).toBe('completed');
  });
});
