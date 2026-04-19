export type YuanEvent =
  | { kind: 'agent:start', goal: string }
  | { kind: 'agent:thinking', content: string }
  | { kind: 'agent:tool_call', tool: string, args?: Record<string, any> }
  | { kind: 'agent:tool_result', tool: string, success: boolean, output?: string }
  | { kind: 'agent:completed', summary: string }
  | { kind: 'agent:error', message: string };

export type SystemEvent =
  | { type: 'project:review', data: any }
  | { type: 'module:log', data: { taskId: string, moduleId: string, message: string } }
  | { type: 'task:manual-trigger', data: { taskId: string } }
  | { type: 'user:reply', data: { taskId: string, content: string, messageId?: number } }
  | { type: 'module:request', data: { requestId: string, taskId: string, toolName: string, args: any[] } }
  | { type: 'module:response', data: { requestId: string, result: any, error?: string } }
  | { type: 'executor:completed', data: { taskId: string, executor: string, sessionName?: string, startedAt?: number } }
  | { type: 'projector:injection', data: { taskId: string, stepId: string, summary: string, sections: string[] } }
  | { type: 'yuan:event', data: YuanEvent };

export type EventCallback<T = any> = (data: T) => void;

export class EventBus {
  private listeners: Record<string, EventCallback[]> = {};

  on<K extends SystemEvent['type']>(event: K, callback: EventCallback<Extract<SystemEvent, { type: K }>['data']>) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
  }

  off<K extends SystemEvent['type']>(event: K, callback: EventCallback<Extract<SystemEvent, { type: K }>['data']>) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
  }

  emit<K extends SystemEvent['type']>(event: K, data: Extract<SystemEvent, { type: K }>['data']) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(cb => cb(data));
    }
  }
}

export const eventBus = new EventBus();
