#!/usr/bin/env node
/**
 * Jules Negotiator Capture Harness
 *
 * Runs real Jules sessions against predefined repos/tasks,
 * captures ALL activity logs and session state transitions,
 * dumps them as JSON fixtures for mock-based tests.
 *
 * Usage:
 *   JULES_API_KEY=xxx node scripts/capture-jules.mjs [scenario...]
 *   JULES_API_KEY=xxx node scripts/capture-jules.mjs --all
 *   JULES_API_KEY=xxx node scripts/capture-jules.mjs --list
 *
 * Fixtures saved to: fixtures/jules-captures/<scenario>-<timestamp>.json
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import nodeFetch from 'node-fetch';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', 'fixtures', 'jules-captures');

const BASE_URL = 'https://jules.googleapis.com/v1alpha';

// ── Helpers ──────────────────────────────────────────────────────────

async function julesRequest(path, apiKey, options = {}) {
  const separator = path.startsWith('/') ? '' : '/';
  const url = `${BASE_URL}${separator}${path}`;
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.ALL_PROXY || process.env.all_proxy;
  let agent;
  if (proxyUrl) {
    if (proxyUrl.startsWith('socks')) {
      const { SocksProxyAgent } = await import('socks-proxy-agent');
      agent = new SocksProxyAgent(proxyUrl);
    } else {
      const { HttpsProxyAgent } = await import('https-proxy-agent');
      agent = new HttpsProxyAgent(proxyUrl);
    }
    log('proxy', `Using proxy: ${proxyUrl}`);
  }
  const response = await nodeFetch(url, {
    ...options,
    ...(agent ? { agent } : {}),
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Jules API ${response.status}: ${body}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

function log(tag, msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] [${tag}] ${msg}`);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Scenarios ────────────────────────────────────────────────────────

const SCENARIOS = {
  'simple-task': {
    description: 'Simple file creation — happy path',
    repo: 'k0inwork/kanban-jules',
    branch: 'main',
    prompt: 'Create a file called hello.txt in the root with the text "Hello from Jules capture test"',
    successCriteria: 'File hello.txt exists with correct content',
    timeoutMin: 10,
  },
  'multi-step': {
    description: 'Multi-step task requiring plan + execution',
    repo: 'k0inwork/kanban-jules',
    branch: 'main',
    prompt: 'Create a simple Node.js script at scripts/echo-args.js that prints all command line arguments, one per line. Then create a test file scripts/echo-args.test.js that verifies it works with 3 sample arguments.',
    successCriteria: 'Both files created, test would pass',
    timeoutMin: 15,
  },
  'code-search': {
    description: 'Code search/analysis — read-only',
    repo: 'k0inwork/kanban-jules',
    branch: 'main',
    prompt: 'Find all files that import from the db service (src/services/db). List each file path and what it imports.',
    successCriteria: 'List of files with their db imports',
    timeoutMin: 10,
  },
  'bug-fix': {
    description: 'Bug fix task — needs understanding existing code',
    repo: 'k0inwork/kanban-jules',
    branch: 'main',
    prompt: 'In the JulesNegotiator, when a session is deleted after timeout, the local DB record is cleaned up. Check if there are any edge cases where the local record could be orphaned (not cleaned up). Report your findings.',
    successCriteria: 'Analysis of edge cases in session cleanup',
    timeoutMin: 15,
  },
  'ambiguous': {
    description: 'Ambiguous task — may need clarification',
    repo: 'k0inwork/kanban-jules',
    branch: 'main',
    prompt: 'Improve the projector performance.',
    successCriteria: 'Measurable improvement suggestion with code changes',
    timeoutMin: 15,
  },
  'nonexistent-path': {
    description: 'Task referencing nonexistent files — error handling',
    repo: 'k0inwork/kanban-jules',
    branch: 'main',
    prompt: 'Fix the bug in src/nonexistent/file.ts that causes the app to crash.',
    successCriteria: 'Bug fix applied',
    timeoutMin: 10,
  },
};

// ── Capture Runner ───────────────────────────────────────────────────

async function captureSession(apiKey, scenario, scenarioName) {
  const fixture = {
    scenario: scenarioName,
    description: scenario.description,
    repo: scenario.repo,
    branch: scenario.branch,
    prompt: scenario.prompt,
    successCriteria: scenario.successCriteria,
    startedAt: new Date().toISOString(),
    session: null,
    stateTransitions: [],
    allActivities: [],
    pollingLog: [],
    result: null,
    error: null,
  };

  const sourceName = `sources/github/${scenario.repo}`;
  const sourceContext = {
    source: sourceName,
    githubRepoContext: scenario.branch ? { startingBranch: scenario.branch } : undefined,
  };

  // 1. Create session
  log(scenarioName, 'Creating session...');
  try {
    let sessionRes = await julesRequest('/sessions', apiKey, {
      method: 'POST',
      body: JSON.stringify({
        title: `[capture] ${scenarioName}`,
        prompt: scenario.prompt,
        sourceContext,
        requirePlanApproval: true,
      }),
    });
    fixture.session = sessionRes;
    log(scenarioName, `Session created: ${sessionRes.name} state=${sessionRes.state}`);

    // Poll until session has a real state (not undefined/QUEUED)
    let pollCount = 0;
    while ((!sessionRes.state || sessionRes.state === 'QUEUED') && pollCount < 30) {
      await sleep(3000);
      try {
        sessionRes = await julesRequest(sessionRes.name, apiKey);
      } catch (e) {
        log(scenarioName, `Session poll error (attempt ${pollCount + 1}): ${e.message}`);
      }
      pollCount++;
    }
    fixture.stateTransitions.push({ state: sessionRes.state, time: new Date().toISOString() });
    log(scenarioName, `Session ready: ${sessionRes.state}`);

    // 2. Auto-approve plan when generated
    let planApproved = false;
    let latestActivityTime = new Date(0).toISOString();
    const startTime = Date.now();
    const maxWaitMs = (scenario.timeoutMin || 10) * 60 * 1000;

    // 3. Poll loop — capture everything
    while (Date.now() - startTime < maxWaitMs) {
      await sleep(5000);

      // Fetch current state
      let currentState;
      try {
        currentState = await julesRequest(sessionRes.name, apiKey);
      } catch (e) {
        log(scenarioName, `State poll error: ${e.message}`);
        fixture.pollingLog.push({ time: new Date().toISOString(), error: e.message });
        await sleep(10000);
        continue;
      }

      if (currentState.state !== (fixture.stateTransitions.at(-1)?.state)) {
        fixture.stateTransitions.push({ state: currentState.state, time: new Date().toISOString() });
        log(scenarioName, `State → ${currentState.state}`);
      }

      // Fetch activities
      let allActivities = [];
      try {
        let pageToken;
        do {
          const params = new URLSearchParams({ pageSize: '100' });
          if (pageToken) params.set('pageToken', pageToken);
          const res = await julesRequest(`${sessionRes.name}/activities?${params}`, apiKey);
          if (res.activities) allActivities = allActivities.concat(res.activities);
          pageToken = res.nextPageToken;
        } while (pageToken);
      } catch (e) {
        log(scenarioName, `Activity fetch error: ${e.message}`);
      }

      // New activities since last check
      const newActivities = allActivities.filter(
        a => !fixture.allActivities.some(existing => existing.id === a.id)
      );

      if (newActivities.length > 0) {
        for (const a of newActivities) {
          fixture.allActivities.push(a);
          const type = a.planGenerated ? 'planGenerated'
            : a.planApproved ? 'planApproved'
            : a.agentMessaged ? 'agentMessaged'
            : a.userMessaged ? 'userMessaged'
            : a.progressUpdated ? 'progressUpdated'
            : a.sessionCompleted ? 'sessionCompleted'
            : a.sessionFailed ? 'sessionFailed'
            : 'unknown';

          log(scenarioName, `Activity: ${type} ${a.description || ''}`.slice(0, 120));

          // Auto-approve plan
          if (a.planGenerated && !planApproved) {
            try {
              await julesRequest(`${sessionRes.name}:approvePlan`, apiKey, {
                method: 'POST',
                body: JSON.stringify({}),
              });
              planApproved = true;
              log(scenarioName, 'Plan auto-approved');
            } catch (e) {
              log(scenarioName, `Plan approval error: ${e.message}`);
            }
          }
        }
      }

      fixture.pollingLog.push({
        time: new Date().toISOString(),
        state: currentState.state,
        totalActivities: allActivities.length,
        newThisPoll: newActivities.length,
      });

      // Terminal states
      if (currentState.state === 'COMPLETED' || currentState.state === 'ARCHIVED') {
        log(scenarioName, 'Session completed');
        break;
      }
      if (currentState.state === 'FAILED') {
        log(scenarioName, 'Session FAILED');
        fixture.error = 'Session FAILED';
        break;
      }

      // Auto-approve plan if state says awaiting (in case planGenerated activity was missed)
      if (currentState.state === 'AWAITING_PLAN_APPROVAL' && !planApproved) {
        try {
          await julesRequest(`${sessionRes.name}:approvePlan`, apiKey, {
            method: 'POST',
            body: JSON.stringify({}),
          });
          planApproved = true;
          log(scenarioName, 'Plan auto-approved (via state check)');
        } catch (e) {
          log(scenarioName, `Plan approval error (state check): ${e.message}`);
        }
      }

      // Auto-respond when Jules wants feedback — approve and continue
      if (currentState.state === 'AWAITING_USER_FEEDBACK') {
        const lastResponse = fixture.autoResponseCount || 0;
        if (lastResponse < 3) { // max 3 auto-responses
          fixture.autoResponseCount = lastResponse + 1;
          log(scenarioName, `Auto-responding to Jules (${lastResponse + 1}/3)...`);
          try {
            await julesRequest(`${sessionRes.name}:sendMessage`, apiKey, {
              method: 'POST',
              body: JSON.stringify({ prompt: 'Yes, please proceed as described. Provide the final result directly in a chat message when done.' }),
            });
          } catch (e) {
            log(scenarioName, `Auto-response error: ${e.message}`);
          }
          await sleep(5000); // brief pause after responding
        }
      }
    }

    // 4. Fetch final session state with outputs
    try {
      const finalSession = await julesRequest(sessionRes.name, apiKey);
      fixture.result = {
        finalState: finalSession.state,
        outputs: finalSession.outputs || [],
        title: finalSession.title,
        url: finalSession.url,
      };
    } catch (e) {
      log(scenarioName, `Final fetch error: ${e.message}`);
    }

  } catch (e) {
    log(scenarioName, `Error: ${e.message}`);
    fixture.error = e.message;
  }

  fixture.completedAt = new Date().toISOString();
  fixture.durationMs = Date.now() - new Date(fixture.startedAt).getTime();
  fixture.totalActivities = fixture.allActivities.length;

  return fixture;
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--list')) {
    console.log('Available scenarios:\n');
    for (const [name, s] of Object.entries(SCENARIOS)) {
      console.log(`  ${name.padEnd(20)} ${s.description}`);
      console.log(`  ${''.padEnd(20)} repo: ${s.repo}  timeout: ${s.timeoutMin}m`);
      console.log();
    }
    return;
  }

  const apiKey = process.env.JULES_API_KEY;
  if (!apiKey) {
    console.error('Error: JULES_API_KEY environment variable required');
    process.exit(1);
  }

  if (!existsSync(FIXTURES_DIR)) {
    mkdirSync(FIXTURES_DIR, { recursive: true });
  }

  const toRun = args.includes('--all')
    ? Object.keys(SCENARIOS)
    : (args.length > 0 ? args : ['simple-task']);

  const unknown = toRun.filter(s => !SCENARIOS[s]);
  if (unknown.length > 0) {
    console.error(`Unknown scenario(s): ${unknown.join(', ')}`);
    console.error('Use --list to see available scenarios');
    process.exit(1);
  }

  console.log(`Running ${toRun.length} scenario(s): ${toRun.join(', ')}\n`);

  const results = [];
  for (const name of toRun) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Scenario: ${name}`);
    console.log(`${'='.repeat(60)}\n`);

    const fixture = await captureSession(apiKey, SCENARIOS[name], name);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${name}-${timestamp}.json`;
    const filepath = join(FIXTURES_DIR, filename);

    writeFileSync(filepath, JSON.stringify(fixture, null, 2));
    console.log(`\nSaved: ${filepath}`);
    console.log(`  Activities: ${fixture.totalActivities}`);
    console.log(`  Duration: ${(fixture.durationMs / 1000).toFixed(0)}s`);
    console.log(`  Error: ${fixture.error || 'none'}`);

    results.push({ name, filename, activities: fixture.totalActivities, error: fixture.error });
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('Summary:');
  for (const r of results) {
    console.log(`  ${r.name.padEnd(20)} ${r.activities} activities  ${r.error || 'OK'}`);
  }
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
