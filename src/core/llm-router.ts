import { LlmLevel, ESCALATION_ORDER } from './llm-levels';
import { eventBus } from './event-bus';
import { shadowLog } from './paw-shadow';

export interface LlmRuntime {
  readonly level: LlmLevel;
  readonly ready: boolean;
  infer(prompt: string, jsonMode?: boolean): Promise<string>;
}

export class LlmRouter {
  private runtimes = new Map<LlmLevel, LlmRuntime>();
  private apiCaller: ((prompt: string, jsonMode?: boolean) => Promise<string>) | null = null;
  private stats = { static: 0, dynamic: 0, global: 0, escalated: 0 };

  registerRuntime(runtime: LlmRuntime): void {
    this.runtimes.set(runtime.level, runtime);
  }

  setApiCaller(fn: (prompt: string, jsonMode?: boolean) => Promise<string>): void {
    this.apiCaller = fn;
  }

  getStats(): { static: number; dynamic: number; global: number; escalated: number } {
    return { ...this.stats };
  }

  /**
   * Route a prompt through the level system.
   * If the preferred level's runtime is unavailable, escalate upward.
   * 'global' always falls back to the API caller.
   */
  async route(
    preferredLevel: LlmLevel,
    prompt: string,
    jsonMode?: boolean
  ): Promise<string> {
    const startIndex = ESCALATION_ORDER.indexOf(preferredLevel);

    for (let i = startIndex; i < ESCALATION_ORDER.length; i++) {
      const level = ESCALATION_ORDER[i];

      if (level === 'global') {
        // Global tier: always use API
        if (!this.apiCaller) throw new Error('No API caller registered for global tier');
        this.stats.global++;
        if (i > startIndex) this.stats.escalated++;
        return this.apiCaller(prompt, jsonMode);
      }

      const runtime = this.runtimes.get(level);
      if (runtime && runtime.ready) {
        try {
          const result = await runtime.infer(prompt, jsonMode);
          this.stats[level]++;
          if (i > startIndex) this.stats.escalated++;

          // Shadow mode: run API in background to compare against local result
          if (this.apiCaller) {
            shadowLog(level, `${level}-call`, prompt, result, this.apiCaller);
          }

          return result;
        } catch (e: any) {
          // Runtime failed — escalate
          eventBus.emit('module:log', {
            taskId: 'system',
            moduleId: 'llm-router',
            message: `${level} runtime failed, escalating: ${e.message}`
          });
        }
      }
    }

    // Should never reach here since global is always last
    throw new Error('No available LLM runtime');
  }
}

export const llmRouter = new LlmRouter();
