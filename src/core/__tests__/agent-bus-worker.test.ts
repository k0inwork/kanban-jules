/**
 * Integration test: agent bus flow through the Web Worker sandbox path
 *
 * Simulates the exact flow used by executor-local:
 *   Sandbox worker → postMessage('toolCall') → Sandbox class → moduleRequest
 *   → eventBus('module:request') → host.ts → registry.invokeHandler
 *   → AgentBus.handleRequest → eventBus('agent:message') → host.ts → eventBus('yuan:event')
 *
 * We can't use a real Worker in vitest, so we simulate the main-thread side
 * of the Sandbox class (the onmessage handler).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { eventBus } from '../event-bus';
import { registry } from '../registry';
import { AgentBus } from '../agent-bus';

// Register the AgentBus handler so registry.invokeHandler works
registry.registerHandler('core-agent-bus.sendMessage', AgentBus.handleRequest);

/**
 * Simulates the Sandbox class's tool call handler (sandbox.ts lines 20-41).
 * In the real app, the worker posts { type: 'toolCall' } and the main thread
 * routes it through moduleRequest via eventBus.
 */
function simulateWorkerToolCall(
  toolName: string,
  args: any[],
  taskId: string,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const requestId = Math.random().toString(36).substring(7);
    const timeoutMs = 5000;

    const timeout = setTimeout(() => {
      eventBus.off('module:response', handler);
      reject(new Error(`moduleRequest timed out after ${timeoutMs / 1000}s: ${toolName}`));
    }, timeoutMs);

    const handler = (data: { requestId: string; result: any; error?: string }) => {
      if (data.requestId === requestId) {
        clearTimeout(timeout);
        eventBus.off('module:response', handler);
        if (data.error) {
          reject(new Error(data.error));
        } else {
          resolve(data.result);
        }
      }
    };

    eventBus.on('module:response', handler);
    eventBus.emit('module:request', { requestId, taskId, toolName, args });
  });
}

/**
 * Simulates host.ts module:request listener (host.ts lines 93-113).
 * This is what receives the eventBus emit and routes through registry.
 */
function setupHostModuleRequestListener() {
  eventBus.on('module:request' as any, async ({ requestId, taskId, toolName, args }: any) => {
    try {
      const moduleId = toolName.split('.')[0];
      const context = {
        taskId,
        repoUrl: '',
        repoBranch: '',
        githubToken: '',
        llmCall: async () => '',
        moduleConfig: {},
      };
      const result = await registry.invokeHandler(toolName, args, context);
      eventBus.emit('module:response', { requestId, result });
    } catch (error: any) {
      eventBus.emit('module:response', { requestId, result: null, error: error.message });
    }
  });
}

describe('Agent bus: Worker sandbox path → eventBus → Yuan', () => {
  const yuanEvents: any[] = [];

  beforeEach(() => {
    (eventBus as any).listeners = {};
    yuanEvents.length = 0;

    // Simulate host.ts setupListeners order:
    // 1. module:request listener (routes tool calls through registry)
    setupHostModuleRequestListener();

    // 2. agent:message → yuan:event forwarding
    eventBus.on('agent:message' as any, (msg: any) => {
      if (msg.to !== 'yuan' && msg.to !== 'broadcast') return;
      if (msg.from === 'yuan') return;
      eventBus.emit('yuan:event' as any, {
        kind: 'agent-message',
        from: msg.from,
        messageType: msg.type,
        payload: msg.payload,
        taskId: msg.taskId,
      });
    });

    // 3. Simulate agent-bootstrap listener
    eventBus.on('yuan:event' as any, (ev: any) => {
      if (!ev || ev.kind !== 'agent-message') return;
      yuanEvents.push(ev);
    });
  });

  it('worker tool call → moduleRequest → registry → AgentBus → yuan:event', async () => {
    // This simulates the executor-local sandbox calling agent.sendMessage
    const result = await simulateWorkerToolCall(
      'core-agent-bus.sendMessage',
      [{ to: 'yuan', type: 'info', payload: { text: 'hello from worker' } }],
      'test-task-123',
    );

    expect(result).toContain('Message sent');
    expect(yuanEvents).toHaveLength(1);
    expect(yuanEvents[0].kind).toBe('agent-message');
    expect(yuanEvents[0].messageType).toBe('info');
    expect(yuanEvents[0].payload).toEqual({ text: 'hello from worker' });
    expect(yuanEvents[0].taskId).toBe('test-task-123');
  });

  it('worker tool call with broadcast reaches yuan', async () => {
    const result = await simulateWorkerToolCall(
      'core-agent-bus.sendMessage',
      [{ to: 'broadcast', type: 'alert', payload: { warning: 'something happened' } }],
      'test-task-456',
    );

    expect(result).toContain('Message sent');
    expect(yuanEvents).toHaveLength(1);
    expect(yuanEvents[0].messageType).toBe('alert');
  });

  it('worker tool call to non-yuan agent does NOT reach yuan', async () => {
    const result = await simulateWorkerToolCall(
      'core-agent-bus.sendMessage',
      [{ to: 'process-agent', type: 'info', payload: { text: 'not for yuan' } }],
      'test-task-789',
    );

    expect(result).toContain('Message sent');
    expect(yuanEvents).toHaveLength(0);
  });

  it('multiple rapid messages all arrive', async () => {
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(
        simulateWorkerToolCall(
          'core-agent-bus.sendMessage',
          [{ to: 'yuan', type: 'info', payload: { i } }],
          'test-task-batch',
        ),
      );
    }
    await Promise.all(promises);

    expect(yuanEvents).toHaveLength(5);
    const payloads = yuanEvents.map(e => e.payload.i).sort();
    expect(payloads).toEqual([0, 1, 2, 3, 4]);
  });
});
