/**
 * Headless test: agent.sendMessage → eventBus → yuan event injection
 *
 * Tests the full in-browser flow without UI:
 * 1. AgentBus.send() emits 'agent:message' on eventBus
 * 2. host.ts listener forwards to 'yuan:event' with kind 'agent-message'
 * 3. The boardVM.on('yuan:event') listener in agent-bootstrap receives it
 *
 * We simulate the chain by wiring up the same listeners.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eventBus } from '../event-bus';
import { AgentBus } from '../agent-bus';

describe('Agent bus → Yuan message flow', () => {
  // Simulate the host.ts listener (setupListeners)
  const setupHostListener = () => {
    eventBus.on('agent:message' as any, (msg: any) => {
      if (msg.to !== 'yuan' && msg.to !== 'broadcast') return;
      if (msg.from === 'yuan') return; // skip self-echo
      eventBus.emit('yuan:event' as any, {
        kind: 'agent-message',
        from: msg.from,
        messageType: msg.type,
        payload: msg.payload,
        taskId: msg.taskId,
      });
    });
  };

  // Simulate the agent-bootstrap boardVM.on listener
  const received: any[] = [];
  const setupBootstrapListener = () => {
    received.length = 0;
    // This mirrors globalThis.boardVM.on('yuan:event', fn)
    // which is patched to eventBus.on in BoardVMContext
    eventBus.on('yuan:event' as any, (ev: any) => {
      if (!ev || ev.kind !== 'agent-message') return;
      received.push(ev);
    });
  };

  beforeEach(() => {
    // Clear all listeners between tests
    (eventBus as any).listeners = {};
    received.length = 0;
  });

  it('AgentBus.send() with to:"yuan" reaches yuan:event listener', () => {
    setupHostListener();
    setupBootstrapListener();

    AgentBus.send({
      from: 'orchestrator',
      to: 'yuan',
      type: 'info',
      payload: { text: 'hello' },
    });

    expect(received).toHaveLength(1);
    expect(received[0].kind).toBe('agent-message');
    expect(received[0].from).toBe('orchestrator');
    expect(received[0].messageType).toBe('info');
    expect(received[0].payload).toEqual({ text: 'hello' });
  });

  it('AgentBus.send() with to:"broadcast" reaches yuan:event listener', () => {
    setupHostListener();
    setupBootstrapListener();

    AgentBus.send({
      from: 'orchestrator',
      to: 'broadcast',
      type: 'status',
      payload: { progress: 50 },
    });

    expect(received).toHaveLength(1);
    expect(received[0].from).toBe('orchestrator');
  });

  it('AgentBus.send() with to:other does NOT reach yuan', () => {
    setupHostListener();
    setupBootstrapListener();

    AgentBus.send({
      from: 'architect',
      to: 'process-agent',
      type: 'info',
      payload: { text: 'not for yuan' },
    });

    expect(received).toHaveLength(0);
  });

  it('handleRequest routes through and reaches yuan', async () => {
    setupHostListener();
    setupBootstrapListener();

    const context = {
      taskId: 'task-123',
      repoUrl: '',
      repoBranch: '',
      githubToken: '',
      llmCall: async () => '',
      moduleConfig: {},
    };

    const result = await AgentBus.handleRequest(
      'core-agent-bus.sendMessage',
      [{ to: 'yuan', type: 'info', payload: { text: 'from handler' } }],
      context as any,
    );

    expect(result).toContain('Message sent');
    expect(received).toHaveLength(1);
    expect(received[0].payload).toEqual({ text: 'from handler' });
  });

  it('self-echo: from:"yuan" to:"yuan" is NOT forwarded', () => {
    setupHostListener();
    setupBootstrapListener();

    AgentBus.send({
      from: 'yuan',
      to: 'yuan',
      type: 'info',
      payload: { text: 'self-echo' },
    });

    expect(received).toHaveLength(0);
  });

  it('multiple messages are all delivered', () => {
    setupHostListener();
    setupBootstrapListener();

    for (let i = 0; i < 5; i++) {
      AgentBus.send({
        from: ('orchestrator') as any,
        to: 'yuan',
        type: 'info',
        payload: { i },
      });
    }

    expect(received).toHaveLength(5);
  });
});
