/**
 * Integration test: full agent bus flow through Sval sandbox
 *
 * Simulates what happens when executor-local runs code that calls agent.sendMessage.
 * Uses main-thread Sval (like YuanSandboxHandler) since Web Workers are hard to test.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Sval from 'sval';
import { eventBus } from '../event-bus';
import { AgentBus } from '../agent-bus';
import { registry } from '../registry';

// Register the AgentBus handler so registry.invokeHandler works
registry.registerHandler('core-agent-bus.sendMessage', AgentBus.handleRequest);

function createSandboxWithBindings(sandboxBindings: Record<string, string>) {
  const interpreter = new Sval({ ecmaVer: 2019, sandBox: true });

  const toolHandler = (qualifiedName: string) => async (...callArgs: any[]) => {
    const result = await registry.invokeHandler(qualifiedName, callArgs, {
      taskId: 'test-task',
      repoUrl: '',
      repoBranch: '',
      githubToken: '',
      llmCall: async () => '',
      moduleConfig: {},
    });
    return result;
  };

  // Group dotted bindings into namespace objects (mirrors sandbox.worker.ts fix)
  const namespaces: Record<string, Record<string, any>> = {};
  const plain: Record<string, any> = {};
  for (const [bindingName, toolName] of Object.entries(sandboxBindings)) {
    const dotIndex = bindingName.indexOf('.');
    if (dotIndex !== -1) {
      const ns = bindingName.substring(0, dotIndex);
      const method = bindingName.substring(dotIndex + 1);
      if (!namespaces[ns]) namespaces[ns] = {};
      namespaces[ns][method] = toolHandler(toolName);
    } else {
      plain[bindingName] = toolHandler(toolName);
    }
  }
  for (const [ns, methods] of Object.entries(namespaces)) {
    interpreter.import(ns, methods);
  }
  for (const [name, fn] of Object.entries(plain)) {
    interpreter.import(name, fn);
  }

  return interpreter;
}

describe('Agent bus: Sval sandbox → eventBus → Yuan', () => {
  const yuanEvents: any[] = [];

  beforeEach(() => {
    (eventBus as any).listeners = {};
    yuanEvents.length = 0;

    // Simulate host.ts listener
    eventBus.on('agent:message' as any, (msg: any) => {
      if (msg.to !== 'yuan' && msg.to !== 'broadcast') return;
      if (msg.from === 'yuan') return;
      console.log('[test] agent:message → yuan:event', msg.from, msg.type);
      eventBus.emit('yuan:event' as any, {
        kind: 'agent-message',
        from: msg.from,
        messageType: msg.type,
        payload: msg.payload,
        taskId: msg.taskId,
      });
    });

    // Simulate agent-bootstrap listener
    eventBus.on('yuan:event' as any, (ev: any) => {
      if (!ev || ev.kind !== 'agent-message') return;
      yuanEvents.push(ev);
    });
  });

  it('agent.sendMessage in Sval sandbox reaches Yuan via eventBus', async () => {
    const sandbox = createSandboxWithBindings({
      'agent.sendMessage': 'core-agent-bus.sendMessage',
    });

    // Run code that calls agent.sendMessage (like executor-local would)
    const holder: { resolve: (v: any) => void; reject: (e: any) => void } = {} as any;
    const resultPromise = new Promise<any>((res, rej) => { holder.resolve = res; holder.reject = rej; });

    sandbox.import('__resolve', (v: any) => holder.resolve(v));
    sandbox.import('__reject', (e: any) => holder.reject(e));

    sandbox.run(`
      (async () => {
        try {
          const result = await agent.sendMessage({
            to: 'yuan',
            type: 'info',
            payload: { text: 'hello from sandbox' }
          });
          __resolve(result);
        } catch (e) {
          __reject(e);
        }
      })();
    `);

    const result = await resultPromise;
    console.log('[test] sandbox result:', result);

    expect(result).toContain('Message sent');
    expect(yuanEvents).toHaveLength(1);
    expect(yuanEvents[0].kind).toBe('agent-message');
    expect(yuanEvents[0].messageType).toBe('info');
    expect(yuanEvents[0].payload).toEqual({ text: 'hello from sandbox' });
  });

  it('multiple bindings (agent.sendMessage + repo.listFiles) work together', async () => {
    // Register a dummy handler for repo.listFiles
    registry.registerHandler('knowledge-repo-browser.listFiles', async () => '[]');

    const sandbox = createSandboxWithBindings({
      'agent.sendMessage': 'core-agent-bus.sendMessage',
      'repo.listFiles': 'knowledge-repo-browser.listFiles',
    });

    const holder: { resolve: (v: any) => void; reject: (e: any) => void } = {} as any;
    const resultPromise = new Promise<any>((res, rej) => { holder.resolve = res; holder.reject = rej; });

    sandbox.import('__resolve', (v: any) => holder.resolve(v));
    sandbox.import('__reject', (e: any) => holder.reject(e));

    sandbox.run(`
      (async () => {
        try {
          const files = await repo.listFiles({ path: '/' });
          const result = await agent.sendMessage({
            to: 'yuan',
            type: 'info',
            payload: { files: files }
          });
          __resolve({ files, sendResult: result });
        } catch (e) {
          __reject(e);
        }
      })();
    `);

    const result = await resultPromise;
    expect(result.files).toBe('[]');
    expect(result.sendResult).toContain('Message sent');
    expect(yuanEvents).toHaveLength(1);
  });
});
