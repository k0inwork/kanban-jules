import { eventBus } from './event-bus';
import { registry } from './registry';
import { ModuleManifest, ActionSubscription } from './types';
import { db } from '../services/db';

export interface ActionContext {
  event: {
    type: string;
    payload: any;
  };
  registry: {
    invoke: (toolName: string, args: any) => Promise<any>;
  };
  db: typeof db;
  eventBus: typeof eventBus;
  projectId?: string;
}

interface ActionHandler {
  filter?: (payload: any) => boolean;
  blocking?: boolean;
  execute: (context: ActionContext) => Promise<void>;
}

interface RegisteredAction {
  manifest: ModuleManifest;
  subscription: ActionSubscription;
  handler: ActionHandler | null;
}

export class ActionDispatcher {
  private actions: RegisteredAction[] = [];
  private listeners: Array<{ event: string; callback: (data: any) => void }> = [];

  init() {
    const actionModules = registry.getModulesByType('action');
    for (const mod of actionModules) {
      if (mod.enabled === false) continue;
      for (const sub of mod.subscriptions ?? []) {
        this.actions.push({ manifest: mod, subscription: sub, handler: null });
      }
      // Enable constitution patches
      this.enableConstitutionPatches(mod);
    }

    // Subscribe to unique events
    const events = new Set(this.actions.map(a => a.subscription.event));
    for (const event of events) {
      const callback = (payload: any) => this.onEvent(event, payload);
      eventBus.on(event as any, callback);
      this.listeners.push({ event, callback });
    }

    console.log(`[ActionDispatcher] Initialized with ${this.actions.length} subscriptions across ${events.size} events`);
  }

  destroy() {
    for (const { event, callback } of this.listeners) {
      eventBus.off(event as any, callback);
    }
    // Disable constitution patches for all action modules
    const actionModules = registry.getModulesByType('action');
    for (const mod of actionModules) {
      this.disableConstitutionPatches(mod);
    }
    this.listeners = [];
    this.actions = [];
  }

  private async onEvent(eventType: string, payload: any) {
    // Find matching actions, sorted by priority (lower = first)
    const matching = this.actions
      .filter(a => a.subscription.event === eventType)
      .sort((a, b) => (a.subscription.priority ?? 100) - (b.subscription.priority ?? 100));

    for (const action of matching) {
      // Layer 1: manifestFilter (fast reject, no module load)
      if (action.subscription.manifestFilter && !this.matchesFilter(payload, action.subscription.manifestFilter)) {
        continue;
      }

      // Load handler lazily
      if (!action.handler) {
        action.handler = this.loadActionHandler(action.manifest.id);
      }
      if (!action.handler) continue;

      // Layer 2: code filter
      if (action.handler.filter && !action.handler.filter(payload)) continue;

      // Build context with tool permission enforcement
      const context = this.buildContext(eventType, payload, action.manifest);

      // Execute with dispatcher-level error handling
      try {
        await action.handler.execute(context);
      } catch (err: any) {
        await this.logActionError(action.manifest.id, eventType, err, payload);
      }
    }
  }

  private matchesFilter(payload: any, filter: Record<string, any>): boolean {
    return Object.entries(filter).every(([key, value]) => payload[key] === value);
  }

  private buildContext(eventType: string, payload: any, manifest: ModuleManifest): ActionContext {
    const allowedTools = new Set(manifest.tools.map(t => t.name));

    return {
      event: { type: eventType, payload },
      registry: {
        async invoke(toolName: string, args: any) {
          if (!allowedTools.has(toolName)) {
            throw new Error(`Action ${manifest.id} not permitted to call ${toolName}`);
          }
          return registry.invokeHandler(toolName, [args], {
            taskId: payload.taskId || '',
            repoUrl: '',
            repoBranch: '',
            llmCall: async () => '',
            moduleConfig: {},
            projectId: payload.projectId,
          });
        },
      },
      db,
      eventBus,
      projectId: payload.projectId,
    };
  }

  private loadActionHandler(moduleId: string): ActionHandler | null {
    // Dynamic handler loading — action modules export an `action` object
    // For now, return null (handlers registered via registerActionHandler)
    const handler = this.handlerMap.get(moduleId);
    if (handler) return handler;
    console.warn(`[ActionDispatcher] No handler registered for action module: ${moduleId}`);
    return null;
  }

  private handlerMap: Map<string, ActionHandler> = new Map();

  registerActionHandler(moduleId: string, handler: ActionHandler) {
    this.handlerMap.set(moduleId, handler);
  }

  private async logActionError(moduleId: string, event: string, err: any, payload: any) {
    console.error(`[ActionDispatcher] Action ${moduleId} failed on ${event}:`, err.message);
    try {
      await db.kbLog.add({
        timestamp: Date.now(),
        text: `Action ${moduleId} failed on ${event}: ${err.message}`,
        category: 'error',
        abstraction: 2,
        layer: ['L0', 'L1'],
        tags: ['action', 'error', moduleId],
        source: 'action-dispatcher',
        active: true,
        projectId: payload.projectId,
      });
    } catch {
      // KB write failure — nothing we can do
    }
  }

  // --- Constitution patch lifecycle ---

  private async enableConstitutionPatches(mod: ModuleManifest) {
    if (!mod.constitutionPatches) return;
    for (const [targetId, patch] of Object.entries(mod.constitutionPatches)) {
      const knowledgeId = `${targetId}:patch-${patch.namespace}`;
      try {
        await db.moduleKnowledge.put({
          id: knowledgeId,
          content: patch.rules.join('\n'),
          updatedAt: Date.now(),
        });
      } catch (err: any) {
        console.error(`[ActionDispatcher] Failed to apply constitution patch ${knowledgeId}:`, err.message);
      }
    }
  }

  private async disableConstitutionPatches(mod: ModuleManifest) {
    if (!mod.constitutionPatches) return;
    for (const [targetId, patch] of Object.entries(mod.constitutionPatches)) {
      const knowledgeId = `${targetId}:patch-${patch.namespace}`;
      try {
        await db.moduleKnowledge.delete(knowledgeId);
      } catch (err: any) {
        console.error(`[ActionDispatcher] Failed to remove constitution patch ${knowledgeId}:`, err.message);
      }
    }
  }
}

export const actionDispatcher = new ActionDispatcher();
