/**
 * PAW (ProgramAsWeights) program specifications.
 * Each spec is a textual description that the PAW compiler turns into
 * a LoRA adapter on GPT-2 124M. Compiled once, runs in ~50ms on WASM/CPU.
 *
 * Only STATIC programs go here. Dynamic/global tasks are handled by WebLLM/API.
 *
 * To compile: paw compile <program-id>
 * To test:    paw eval <program-id> --cases test-cases/<program-id>.json
 */

export interface PawProgram {
  id: string;
  description: string;
  inputFormat: string;
  outputFormat: string;
  examples: { input: string; output: string }[];
}

export const PAW_PROGRAMS: Record<string, PawProgram> = {

  // ─── signal-noise ───────────────────────────────────────────────
  // Classifies Jules agent messages as requiring attention or not.
  // Used by JulesPostman to decide whether to surface a message to the user.
  // This is truly static: fixed 2-class taxonomy, input is just message text.

  'signal-noise': {
    id: 'signal-noise',
    description: [
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
    inputFormat: 'A single text string: the agent message.',
    outputFormat: 'Exactly "SIGNAL" or "NOISE" (uppercase, no other text).',
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
};
