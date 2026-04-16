export type SystemEvent = 
  | { type: 'project:review', data: any }
  | { type: 'module:log', data: { taskId: string, moduleId: string, message: string } }
  | { type: 'task:manual-trigger', data: { taskId: string } }
  | { type: 'user:reply', data: { taskId: string, content: string, messageId?: number } }
  | { type: 'module:request', data: { requestId: string, taskId: string, toolName: string, args: any[] } }
  | { type: 'module:response', data: { requestId: string, result: any, error?: string } };

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
