import { eventBus, YuanEvent } from '../../core/event-bus';
import { AgentTreeNode, AgentTreeState, NodeState } from './types';
import { db } from '../../services/db';

type ChangeCallback = (state: AgentTreeState) => void;

const STORAGE_KEY = 'agent-tree-state';

/**
 * Builds a live tree of active tasks by subscribing to EventBus events.
 *
 * Append-only within a task: nodes are created once and transition state.
 * Whole task subtrees are removed when the task completes.
 *
 * State is persisted to localStorage. On load, entries for tasks that
 * no longer exist in the DB are pruned.
 */
export class AgentTreeModel {
  private state: AgentTreeState = {
    tasks: new Map(),
    taskOrder: [],
  };

  /** requestId → node ID (to match module:response back to the tool node) */
  private pendingRequests = new Map<string, string>();

  /** taskId → current step node ID (tool calls attach under current step) */
  private activeStep = new Map<string, string>();

  /** Yuan tool_call counter for unique IDs */
  private yuanToolCounter = 0;

  private listeners = new Set<ChangeCallback>();
  private unsubscribers: (() => void)[] = [];

  constructor() {
    this.loadFromStorage();
    this.ensureYuan(); // Yuan always visible
    this.unsubscribers.push(
      this.on('module:log', this.handleLog.bind(this)),
      this.on('module:request', this.handleRequest.bind(this)),
      this.on('module:response', this.handleResponse.bind(this)),
      this.on('executor:completed', this.handleExecutorCompleted.bind(this)),
      this.on('yuan:event', this.handleYuanEvent.bind(this)),
    );
  }

  // ── public API ──────────────────────────────────────────────

  getState(): AgentTreeState {
    return this.state;
  }

  /** Prune entries whose tasks no longer exist. Call after DB is ready. */
  async pruneStaleTasks(existingTaskIds: string[]) {
    const validSet = new Set(existingTaskIds);
    validSet.add('yuan-agent'); // Never prune Yuan
    let changed = false;
    for (const id of this.state.taskOrder) {
      if (!validSet.has(id)) {
        this.state.tasks.delete(id);
        changed = true;
      }
    }
    this.state.taskOrder = this.state.taskOrder.filter(id => validSet.has(id));
    if (changed) {
      this.saveToStorage();
      this.emit();
    }
  }

  subscribe(cb: ChangeCallback): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  destroy() {
    this.unsubscribers.forEach(fn => fn());
    this.unsubscribers = [];
    this.listeners.clear();
  }

  // ── event handlers ──────────────────────────────────────────

  private static MAX_LOGS = 50;

  private handleLog(data: { taskId: string; moduleId: string; message: string }) {
    const { taskId, moduleId, message } = data;
    if (!taskId || taskId === 'system') return;

    // Route logs to running tool under active step, then step, then task root
    const taskNode = this.state.tasks.get(taskId);
    if (taskNode) {
      const activeStepId = this.activeStep.get(taskId);
      let target: AgentTreeNode | undefined;
      if (activeStepId) {
        const stepNode = this.findNode(taskNode, activeStepId);
        if (stepNode) {
          const runningTool = stepNode.children.find(c => c.state === 'running');
          target = runningTool || stepNode;
        }
      }
      if (!target) target = taskNode;

      if (!target.logs) target.logs = [];
      target.logs.push(message);
      if (target.logs.length > AgentTreeModel.MAX_LOGS) {
        target.logs = target.logs.slice(-AgentTreeModel.MAX_LOGS);
      }
      target.detail = message.slice(0, 100);
      this.emit();
    }

    if (moduleId === 'orchestrator') {
      this.handleOrchestratorLog(taskId, message);
    } else if (moduleId === 'architect') {
      this.handleArchitectLog(taskId, message);
    }
  }

  private handleOrchestratorLog(taskId: string, message: string) {
    if (message.includes('Initializing Agent Session')) {
      this.ensureTask(taskId, 'running');
    } else if (message.match(/Started Step (\d+)/)) {
      const match = message.match(/Started Step (\d+)/);
      if (match) {
        const stepNum = match[1];
        const stepId = `task:${taskId}:step:${stepNum}`;
        this.ensureTask(taskId, 'running');

        const taskNode = this.state.tasks.get(taskId)!;
        // Mark previous steps completed, clear their logs
        for (const child of taskNode.children) {
          if (child.state === 'running' || child.state === 'pending') {
            child.state = 'completed';
            child.durationMs = Date.now() - child.timestamp;
          }
          child.logs = [];
        }
        // Clear root logs — log window moves to the new step
        taskNode.logs = [];

        const stepNode: AgentTreeNode = {
          id: stepId,
          type: 'step',
          name: `Step ${stepNum}`,
          state: 'running',
          detail: undefined,
          children: [],
          timestamp: Date.now(),
        };
        taskNode.children.push(stepNode);
        this.activeStep.set(taskId, stepId);
        this.emit();
      }
    } else if (message.match(/Error in Step (\d+)/)) {
      const match = message.match(/Error in Step (\d+)/);
      if (match) {
        const stepId = `task:${taskId}:step:${match[1]}`;
        this.updateNodeState(stepId, 'error');
      }
    } else if (message.includes('Step execution complete')) {
      // Mark all remaining steps completed
      const taskNode = this.state.tasks.get(taskId);
      if (taskNode) {
        for (const child of taskNode.children) {
          if (child.state === 'running') {
            child.state = 'completed';
            child.durationMs = Date.now() - child.timestamp;
          }
        }
      }
      if (message.includes('DONE')) {
        this.completeTask(taskId);
      }
    }
  }

  private handleArchitectLog(taskId: string, message: string) {
    this.ensureTask(taskId, 'running');

    const taskNode = this.state.tasks.get(taskId)!;
    // Find or create architect node
    let archNode = taskNode.children.find(c => c.id === `task:${taskId}:architect`);
    if (!archNode) {
      archNode = {
        id: `task:${taskId}:architect`,
        type: 'phase',
        name: 'Architect',
        state: 'running',
        detail: undefined,
        children: [],
        timestamp: Date.now(),
      };
      // Insert architect at the beginning
      taskNode.children.unshift(archNode);
    }

    if (message.includes('code:')) {
      archNode.detail = 'Generated code';
    } else {
      archNode.detail = message.slice(0, 80);
    }
    this.emit();
  }

  private handleRequest(data: { requestId: string; taskId: string; toolName: string; args: any[] }) {
    const { requestId, taskId, toolName } = data;
    if (!taskId) return;

    this.ensureTask(taskId, 'running');
    const taskNode = this.state.tasks.get(taskId)!;

    // Determine parent: current step if exists, otherwise task root
    const stepId = this.activeStep.get(taskId);
    let parent: AgentTreeNode;
    if (stepId) {
      const stepNode = this.findNode(taskNode, stepId);
      parent = stepNode || taskNode;
    } else {
      parent = taskNode;
    }

    // Determine node type from toolName
    const moduleId = toolName.split('.')[0];
    const nodeType = this.nodeTypeFromModule(moduleId);
    const display = this.toolDisplayName(toolName);

    // Mark architect as completed when first non-architect tool is called
    if (moduleId !== 'architect-codegen') {
      const archNode = taskNode.children.find(c => c.id === `task:${taskId}:architect`);
      if (archNode && archNode.state === 'running') {
        archNode.state = 'completed';
        archNode.durationMs = Date.now() - archNode.timestamp;
      }
    }

    const nodeId = `task:${taskId}:tool:${requestId}`;
    const toolNode: AgentTreeNode = {
      id: nodeId,
      type: nodeType,
      name: display,
      state: 'running',
      detail: this.argsSummary(toolName, data.args),
      children: [],
      timestamp: Date.now(),
    };

    parent.children.push(toolNode);
    this.pendingRequests.set(requestId, nodeId);
    this.emit();
  }

  private handleResponse(data: { requestId: string; result: any; error?: string }) {
    const nodeId = this.pendingRequests.get(data.requestId);
    if (!nodeId) return;

    this.pendingRequests.delete(data.requestId);
    const state: NodeState = data.error ? 'error' : 'completed';
    const detail = data.error
      ? data.error.slice(0, 300)
      : this.resultSummary(data.result, 300);

    this.updateNode(nodeId, state, detail);
  }

  private handleExecutorCompleted(data: { taskId: string; executor: string; startedAt?: number }) {
    const { taskId, startedAt } = data;
    const duration = startedAt ? Date.now() - startedAt : undefined;

    // Mark any still-running nodes under this task as completed
    const taskNode = this.state.tasks.get(taskId);
    if (taskNode) {
      this.markAllRunningCompleted(taskNode, duration);
    }

    // Remove task from tree (user said "only working tasks")
    this.removeTask(taskId);
  }

  // ── tree mutations ──────────────────────────────────────────

  private ensureTask(taskId: string, state: NodeState) {
    if (!this.state.tasks.has(taskId)) {
      const taskNode: AgentTreeNode = {
        id: `task:${taskId}`,
        type: 'task',
        name: `Task ${taskId.slice(0, 8)}`,
        state,
        detail: undefined,
        children: [],
        timestamp: Date.now(),
      };
      this.state.tasks.set(taskId, taskNode);
      this.state.taskOrder.push(taskId);
      // Async-fetch real title from DB
      db.tasks.get(taskId).then(task => {
        if (task?.title) {
          const node = this.state.tasks.get(taskId);
          if (node) {
            node.name = task.title;
            this.emit();
          }
        }
      }).catch(() => {});
    } else {
      const taskNode = this.state.tasks.get(taskId)!;
      if (taskNode.state !== state && state === 'running') {
        taskNode.state = state;
      }
    }
    this.emit();
  }

  private completeTask(taskId: string) {
    const taskNode = this.state.tasks.get(taskId);
    if (taskNode) {
      this.markAllRunningCompleted(taskNode);
      taskNode.state = 'completed';
    }
    // Remove after short delay so user sees the green flash
    setTimeout(() => this.removeTask(taskId), 2000);
  }

  private removeTask(taskId: string) {
    this.state.tasks.delete(taskId);
    this.state.taskOrder = this.state.taskOrder.filter(id => id !== taskId);
    this.activeStep.delete(taskId);
    this.emit();
  }

  private updateNodeState(nodeId: string, state: NodeState) {
    for (const taskNode of Array.from(this.state.tasks.values())) {
      const node = this.findNode(taskNode, nodeId);
      if (node) {
        node.state = state;
        if (state === 'completed' || state === 'error') {
          node.durationMs = Date.now() - node.timestamp;
        }
        this.emit();
        return;
      }
    }
  }

  private updateNode(nodeId: string, state: NodeState, detail?: string) {
    for (const taskNode of Array.from(this.state.tasks.values())) {
      const node = this.findNode(taskNode, nodeId);
      if (node) {
        node.state = state;
        node.detail = detail || node.detail;
        if (state === 'completed' || state === 'error') {
          node.durationMs = Date.now() - node.timestamp;
        }
        this.emit();
        return;
      }
    }
  }

  private markAllRunningCompleted(node: AgentTreeNode, duration?: number) {
    if (node.state === 'running') {
      node.state = 'completed';
      node.durationMs = duration || (Date.now() - node.timestamp);
    }
    for (const child of node.children) {
      this.markAllRunningCompleted(child, duration);
    }
  }

  // ── helpers ─────────────────────────────────────────────────

  private findNode(root: AgentTreeNode, id: string): AgentTreeNode | null {
    if (root.id === id) return root;
    for (const child of root.children) {
      const found = this.findNode(child, id);
      if (found) return found;
    }
    return null;
  }

  private nodeTypeFromModule(moduleId: string): AgentTreeNode['type'] {
    if (moduleId.startsWith('executor-')) return 'executor';
    if (moduleId.startsWith('channel-')) return 'negotiator';
    if (moduleId === 'architect-codegen') return 'phase';
    if (moduleId.startsWith('knowledge-')) return 'tool';
    return 'tool';
  }

  private toolDisplayName(toolName: string): string {
    const [moduleId, method] = toolName.split('.');
    switch (moduleId) {
      case 'architect-codegen': return 'Architect';
      case 'executor-jules': return `Jules: ${method}`;
      case 'executor-local': return `Local: ${method}`;
      case 'executor-github': return `GitHub: ${method}`;
      case 'channel-user-negotiator': return `User: ${method}`;
      case 'knowledge-kb': return `KB.${method}`;
      case 'knowledge-repo-browser': return `Repo.${method}`;
      case 'knowledge-artifacts': return `Artifact.${method}`;
      case 'knowledge-projector': return `Projector.${method}`;
      case 'knowledge-local-analyzer': return `Analyzer.${method}`;
      case 'process-dream': return `Dream.${method}`;
      case 'process-reflection': return `Reflect.${method}`;
      case 'process-project-manager': return `PM.${method}`;
      default: return toolName;
    }
  }

  private argsSummary(_toolName: string, args: any[]): string | undefined {
    if (!args || args.length === 0) return undefined;
    const first = args[0];
    if (typeof first === 'string') return first.slice(0, 80);
    if (typeof first === 'object' && first !== null) {
      try { return JSON.stringify(first).slice(0, 80); } catch { return undefined; }
    }
    return undefined;
  }

  private resultSummary(result: any, maxLen = 80): string | undefined {
    if (result === null || result === undefined) return undefined;
    if (typeof result === 'string') return result.slice(0, maxLen);
    if (typeof result === 'boolean') return result ? 'OK' : 'Failed';
    if (typeof result === 'number') return String(result);
    try { return JSON.stringify(result).slice(0, maxLen); } catch { return undefined; }
  }

  // ── Yuan event handler ────────────────────────────────────────

  /** Ensure Yuan root node always exists (persistent, never removed) */
  private ensureYuan(): AgentTreeNode {
    const yuanRootId = 'yuan-agent';
    let root = this.state.tasks.get(yuanRootId);
    if (!root) {
      root = {
        id: yuanRootId,
        type: 'task',
        name: 'Yuan Agent',
        state: 'idle',
        detail: 'Waiting...',
        children: [],
        timestamp: Date.now(),
      };
      this.state.tasks.set(yuanRootId, root);
      // Yuan always at top
      this.state.taskOrder.unshift(yuanRootId);
    }
    return root;
  }

  private handleYuanEvent(ev: YuanEvent) {
    const root = this.ensureYuan();

    switch (ev.kind) {
      case 'agent:thinking': {
        // New user turn — clear previous tool call children
        root.children = [];
        root.detail = ev.content.slice(0, 100);
        root.state = 'running';
        this.emit();
        break;
      }

      case 'agent:tool_call': {
        this.yuanToolCounter++;
        const nodeId = `yuan:tool:${this.yuanToolCounter}`;

        const argsStr = ev.args
          ? Object.entries(ev.args).map(([k, v]) => `${k}=${String(v).slice(0, 40)}`).join(', ')
          : undefined;

        root.children.push({
          id: nodeId,
          type: 'tool',
          name: ev.tool,
          state: 'running',
          detail: argsStr?.slice(0, 100),
          children: [],
          timestamp: Date.now(),
        });
        root.state = 'running';
        this.emit();
        break;
      }

      case 'agent:tool_result': {
        const toolNode = [...root.children].reverse().find(
          c => c.name === ev.tool && c.state === 'running'
        );
        if (toolNode) {
          toolNode.state = ev.success ? 'completed' : 'error';
          toolNode.detail = ev.output?.slice(0, 100) || (ev.success ? 'OK' : 'Failed');
          toolNode.durationMs = Date.now() - toolNode.timestamp;
        }
        this.emit();
        break;
      }

      case 'agent:completed': {
        this.markAllRunningCompleted(root);
        root.state = 'completed';
        root.detail = ev.summary?.slice(0, 100);
        this.emit();
        // Reset to idle after brief flash
        setTimeout(() => {
          root.state = 'idle';
          root.detail = 'Waiting...';
          root.children = [];
          this.emit();
        }, 2000);
        break;
      }

      case 'agent:error': {
        root.state = 'error';
        root.detail = ev.message?.slice(0, 100);
        for (const child of root.children) {
          if (child.state === 'running') child.state = 'error';
        }
        this.emit();
        // Reset to idle after error flash
        setTimeout(() => {
          root.state = 'idle';
          root.detail = 'Waiting...';
          this.emit();
        }, 3000);
        break;
      }
    }
  }

  // ── event bus wiring ────────────────────────────────────────

  private on<K extends string>(event: K, handler: (data: any) => void): () => void {
    (eventBus as any).on(event, handler);
    return () => (eventBus as any).off(event, handler);
  }

  private emit() {
    this.saveToStorage();
    const snapshot: AgentTreeState = {
      tasks: new Map(this.state.tasks),
      taskOrder: [...this.state.taskOrder],
    };
    for (const cb of Array.from(this.listeners)) {
      cb(snapshot);
    }
  }

  // ── persistence ─────────────────────────────────────────────

  private saveToStorage() {
    try {
      const serializable = {
        tasks: this.state.taskOrder.map(id => {
          const node = this.state.tasks.get(id);
          return node ? [id, node] : null;
        }).filter(Boolean) as [string, AgentTreeNode][],
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
    } catch { /* quota exceeded or SSR */ }
  }

  private loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.tasks && Array.isArray(data.tasks)) {
        for (const [id, node] of data.tasks) {
          this.state.tasks.set(id, node);
          this.state.taskOrder.push(id);
        }
      }
    } catch { /* corrupt data — start fresh */ }
  }
}
