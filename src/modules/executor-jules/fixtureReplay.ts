import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

const FIXTURES_DIR = resolve('fixtures/jules-captures');

export interface JulesFixture {
  scenario: string;
  description: string;
  repo: string;
  branch: string;
  prompt: string;
  successCriteria: string;
  startedAt: string;
  session: { name: string; state?: string; [k: string]: any };
  stateTransitions: { state: string; time: string }[];
  allActivities: any[];
  pollingLog: { time: string; state: string; totalActivities: number; newThisPoll: number; error?: string }[];
  result: { finalState: string; outputs: any[]; [k: string]: any } | null;
  error: string | null;
}

/**
 * Load the latest fixture for a given scenario.
 */
export function loadFixture(scenario: string): JulesFixture {
  const files = readdirSync(FIXTURES_DIR)
    .filter(f => f.startsWith(scenario + '-') && f.endsWith('.json'))
    .sort();

  if (files.length === 0) {
    throw new Error(`No fixture found for scenario: ${scenario}`);
  }

  const content = readFileSync(resolve(FIXTURES_DIR, files[files.length - 1]), 'utf-8');
  return JSON.parse(content);
}

/**
 * Adjust fixture activity timestamps so they work with fake timers.
 * Remaps all timestamps to be in the far future (2099), spaced `spacing` ms apart.
 * This ensures the negotiator's `latestActivityTimestamp` filter picks them up
 * as "new" relative to `Date.now()` at fake timer start.
 */
export function adjustTimestamps(activities: any[], baseTime = '2099-06-01T00:00:00.000Z', spacing = 10000) {
  const base = new Date(baseTime).getTime();
  return activities.map((a, i) => ({
    ...a,
    createTime: new Date(base + i * spacing).toISOString(),
  }));
}
