/**
 * LLM Level system for cost-optimized routing.
 * static  → PAW (compiled micro-programs, ~50ms, free)
 * dynamic → WebLLM (local browser inference, ~1-3s, free)
 * global  → API (Gemini/OpenAI, high quality, costs money)
 */

export type LlmLevel = 'static' | 'dynamic' | 'global';

/**
 * Maps logical call-site names to their appropriate LLM level.
 * Used by callers to declare intent; the router escalates automatically
 * if the preferred runtime is unavailable.
 */
export const CALL_LEVELS: Record<string, LlmLevel> = {
  // static — simple classification (PAW territory)
  'signal-noise': 'static',
  'verify-progress': 'static',
  'verify-output': 'static',

  // dynamic — validation against dynamic criteria (WebLLM territory)
  'format-validate': 'dynamic',

  // dynamic — extraction / analysis (WebLLM territory)
  'task-extract': 'dynamic',
  'session-analyze': 'dynamic',

  // global — code generation / planning (needs high quality)
  'architect-plan': 'global',
  'programmer-codegen': 'global',
  'analyze-tool': 'global',
  'project-review': 'global',
};

/** Escalation order: if a level is unavailable, try the next one. */
export const ESCALATION_ORDER: LlmLevel[] = ['static', 'dynamic', 'global'];
