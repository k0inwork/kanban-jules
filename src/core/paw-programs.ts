/**
 * PAW (ProgramAsWeights) — the program IS the prompt.
 *
 * Each program has multiple prompt variants. In dev mode, all variants
 * are tested via shadow mode to find the best one. In prod, only the
 * active variant is used.
 *
 * Improvement loop: LLM analyzes disagreements and generates new variants.
 */

export interface PawVariant {
  id: string;
  prompt: string;
  description: string; // what changed vs previous variant
  examples: { input: string; output: string }[];
}

export interface PawProgram {
  id: string;
  inputFormat: string;
  outputFormat: string;
  activeVariantId: string;
  variants: PawVariant[];
}

/** Get the active variant for a program */
export function getActiveVariant(program: PawProgram): PawVariant {
  const v = program.variants.find(v => v.id === program.activeVariantId);
  if (!v) throw new Error(`No active variant found for ${program.id}`);
  return v;
}

/** Build the full prompt for a PAW call: prompt template + input */
export function buildPawPrompt(program: PawProgram, input: string): string {
  const variant = getActiveVariant(program);
  return `${variant.prompt}\n\nInput: ${input}\nOutput:`;
}

export const PAW_PROGRAMS: Record<string, PawProgram> = {

  // ─── signal-noise ───────────────────────────────────────────────
  // Classifies Jules agent messages as requiring attention or not.
  // Used by JulesPostman to decide whether to surface a message.

  'signal-noise': {
    id: 'signal-noise',
    inputFormat: 'A single text string: the agent message.',
    outputFormat: 'Exactly "SIGNAL" or "NOISE" (uppercase, no other text).',
    activeVariantId: 'v1',

    variants: [
      {
        id: 'v1',
        description: 'Initial variant — basic classification instructions',
        prompt: [
          'Classify a message from an automated coding agent (Jules) into exactly one of two categories.',
          '',
          'Return SIGNAL if the message:',
          '- Asks a question or requests user feedback',
          '- Presents a plan or architectural decision for review',
          '- Reports task completion with a result, PR URL, or branch name',
          '- Reports an error, blocker, or failure',
          '- Requests clarification on requirements',
          '',
          'Return NOISE if the message:',
          '- Reports routine progress ("I am working on...", "Continuing with...")',
          '- Shows internal thoughts or reasoning without a question',
          '- Lists files being read or commands being run',
          '- Says something is in progress without a final result',
          '- General status updates without actionable content',
        ].join('\n'),
        examples: [
          { input: 'I have finished implementing the feature. Please review the changes in PR #42.', output: 'SIGNAL' },
          { input: "I'm currently reading through the codebase to understand the architecture.", output: 'NOISE' },
          { input: 'Should I use PostgreSQL or MongoDB for this use case?', output: 'SIGNAL' },
          { input: 'Running tests now...', output: 'NOISE' },
          { input: 'I encountered an error: module not found. The package xyz is missing from package.json.', output: 'SIGNAL' },
          { input: 'Step 3 of 5: Refactoring the database layer.', output: 'NOISE' },
          { input: 'Here is my proposed architecture: [detailed plan]. What do you think?', output: 'SIGNAL' },
          { input: 'Analyzing the existing test suite to identify gaps.', output: 'NOISE' },
          { input: 'Task completed. Branch: task/550e8400. All tests passing.', output: 'SIGNAL' },
          { input: 'Reading file src/index.ts to understand the entry point.', output: 'NOISE' },
        ],
      },
    ],
  },
};
