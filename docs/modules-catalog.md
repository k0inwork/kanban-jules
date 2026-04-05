# Module System: Bundled & Future Modules

> Sub-document of [modules.md](modules.md) — the unified capability model proposal.
> This file covers the module registry, bundled modules, install flow, and future catalog.

---

## 8. Module Registry

### 8.1 Bundled Modules (autoloaded)

Shipped in the repo under `src/modules/`. Discovered at build time, registered on app start.

```
src/modules/
  architect-codegen/
    index.ts
    manifest.json
  knowledge-artifacts/
    index.ts
    manifest.json
  knowledge-repo-browser/
    index.ts
    manifest.json
  executor-jules/
    index.ts
    manifest.json
  executor-local/
    index.ts
    manifest.json
  channel-mailbox/
    index.ts
    manifest.json
```

### 8.1.0 Architect Modules

The host calls exactly one architect module per task. The architect produces either a step plan (protocol), executable code, or both. The host then executes the output.

Architect modules are the most powerful module type — they control what code runs, what APIs get called, how steps are sequenced. But they're still modules: isolated in workers, loaded from manifests, swappable without touching core.

#### architect-codegen-full (current)

Current code: `src/services/Orchestrator.ts` (Programmer Agent prompt + Sval execution) + `src/services/TaskArchitect.ts` (protocol generation)

The current system split: `TaskArchitect` generates the step plan (protocol), then `Programmer Agent` generates code per step. This architect combines both.

```
description: "Full code-generation architect. Given a task description
  and available sandbox APIs, I produce:
  1. A step plan (protocol) breaking the task into ordered steps,
     each assigned to the best available executor.
  2. JS code for each step that the host runs in a sandbox.

  I read all registered module descriptions to make routing decisions.
  I generate multi-step protocols for complex tasks. I handle errors
  by regenerating code with error context. I use GlobalVars for
  cross-step state persistence.

  Best for: complex tasks requiring multiple API calls, error handling,
  state management, and structured decomposition.

  Overkill for: simple single-delegation tasks ('ask Jules to do X')."

outputType: 'protocol+code'

requiresBindings: '*'   // sees all available sandbox APIs

tools: []   // architects don't expose tools — they receive context and produce output

sandboxBindings: {}   // nothing calls the architect from sandbox code

permissions: ['network']   // needs LLM API for code generation

trigger: undefined   // called by host, not self-triggered
```

**How the host uses this architect:**
1. Host calls `architect.generateProtocol(task, moduleDescriptions)` → returns `TaskProtocol`
2. For each step, host calls `architect.generateCode(task, step, globalVars, availableAPIs, accumulatedAnalysis, errorContext?)` → returns JS code string
3. Host executes code in sandbox with all modules' sandbox bindings injected
4. On error, host calls `architect.generateCode` again with error context (retry)
5. On all steps done, host marks task DONE

**Context forwarding with `analyze` (codegen-full only):**

Multi-step code needs context transfer between steps. GlobalVars carry explicit state, but the Programmer Agent also produces analysis that the next step should see. The `analyze` tool solves this.

`analyze(text)` is a sandbox tool available only in the codegen-full architect's execution. The Programmer Agent calls it to produce a structured LLM analysis of any text — requirements, code, specs, search results. The result is saved as an artifact and automatically forwarded to all subsequent steps.

```typescript
// In Programmer Agent's generated code (step 1):
const spec = await analyze("What auth patterns exist in the codebase? Search for JWT, sessions, OAuth usage.");
// spec is auto-remembered by host — no need to save as artifact
// use it in code:
const design = await askJules(`Implement auth based on: ${spec}`, "...");

// Optionally, if user should see it:
await Artifacts.saveArtifact("auth_analysis.md", spec);
```

**How it works:**
1. Host injects two context tools into the sandbox for codegen-full steps:
   - `analyze(text: string): Promise<string>` — LLM call, returns structured analysis
   - `addToContext(text: string): void` — no LLM call, just remembers the string
2. Host automatically collects every `analyze()` return and `addToContext()` argument into a per-task context log
3. Before each step, host injects all previous context entries as `accumulatedAnalysis` into the prompt
4. The Programmer Agent decides when to call either — not every step needs them
5. Saving as artifact is optional — only if the result should be visible to the user on the board

**`analyze` vs `addToContext`:**

| Tool | Cost | Use when |
|------|------|----------|
| `analyze(text)` | LLM call | Need structured reasoning about something — "analyze the auth patterns", "summarize test coverage gaps" |
| `addToContext(text)` | Free | Already have the text, just want next steps to see it — user reply, tool output, intermediate value |

```typescript
// analyze — needs LLM reasoning
const spec = await analyze("What auth patterns exist in the codebase?");

// addToContext — just forwarding what you already have
const goal = await askUser("What's the primary goal?");
addToContext("User specified goal: " + goal);

const fileList = await Artifacts.listArtifacts();
addToContext("Available artifacts: " + fileList.map(a => a.name).join(", "));
```

**Three destinations for analysis results:**

| Destination | When | How |
|-------------|------|-----|
| Auto-forwarded context | Always | Host collects all `analyze()` returns, feeds to next steps |
| GlobalVars | If next step's code needs to reference a specific value | `GlobalVars.set('tokenFormat', result)` |
| Artifact | If user should see it on the board | `Artifacts.saveArtifact('auth_analysis.md', result)` |

**Context flow across steps:**

```
Step 1 prompt:  task desc + step 1 desc + GlobalVars (empty)
  Code: spec = analyze("auth patterns?")

Step 2 prompt:  task desc + step 2 desc + GlobalVars + accumulatedAnalysis:
                "Step 1 analysis: 'Codebase uses JWT with RS256, refresh tokens in Redis...'"

Step 3 prompt:  task desc + step 3 desc + GlobalVars + accumulatedAnalysis:
                "Step 1 analysis: '...' | Step 2 analysis: 'Existing test coverage at 40%...'"
```

Each step sees the collective analyses from all previous steps. The Programmer Agent curates what gets analyzed. No manual artifact management needed for forwarding — it's automatic.

**Why only codegen-full:** Single-step architects (codegen-simple) run one code block — no context transfer needed. Describer and planner produce descriptions for executors — the executor's own negotiator handles context. Only codegen-full has multiple code execution steps in sequence where context accumulates.

**Current code gap:** The existing `Orchestrator.ts` prompt (lines 119-146) passes task title, step description, and GlobalVars — but no analysis from previous steps. The `analyze` tool doesn't exist yet. This is the missing context transfer mechanism.

**Current code this replaces:**
- `TaskArchitect.parseTasksFromMessage()` + `TaskArchitect.generateTaskProtocol()` → `generateProtocol()`
- `Orchestrator.runStep()` prompt composition → `generateCode()`
- `Orchestrator.executeInSandbox()` sandbox injection → host's generic injection loop
- Both currently hardcoded with Jules-specific XML tags and delegation logic

#### architect-codegen-simple (future)

```
description: "Simple code-generation architect. Skips the protocol/step
  planning entirely. Given a task description, I produce one JS code
  block that runs directly in the sandbox.

  I see all available sandbox APIs and GlobalVars. I write code that
  accomplishes the task in one shot. If the task is too complex for
  a single code block, I throw and the host should fall back to
  architect-codegen-full.

  Best for: single-step tasks, quick transformations, simple API calls.
  Examples: 'save this analysis as an artifact', 'ask the user for
  clarification and store in GlobalVars', 'read the repo structure
  and summarize'.

  NOT for: multi-step workflows, complex error handling, tasks
  requiring different executors per step."

outputType: 'code'

requiresBindings: '*'

tools: []
sandboxBindings: {}
permissions: ['network']
trigger: undefined
```

**How the host uses this architect:**
1. Host calls `architect.generateCode(task, globalVars, availableAPIs)` → returns JS code string
2. Host executes code in sandbox
3. On error, retry with error context (up to N times)
4. On success, mark task DONE

No step plan. No protocol. One shot. Faster prompt, faster execution, less LLM cost.

#### architect-describer (future)

```
description: "Description-only architect. I produce step plans where
  each step is just a text description — no code. The host sends
  each step description directly to the assigned executor as a prompt.

  Use me when all steps are pure delegation to autonomous executors
  (Jules, OpenClaude). No need to generate glue code — the executors
  handle everything themselves.

  I still assign executors per step. I still respect executor
  descriptions for routing. But I skip code generation entirely.

  Best for: tasks that are 100% delegation ('implement feature X with
  tests via Jules', then 'review via OpenClaude').
  NOT for: tasks needing local logic, artifact manipulation, GlobalVars,
  or multi-API orchestration."

outputType: 'protocol'

requiresBindings: []   // doesn't need to see API details — no code to write

tools: []
sandboxBindings: {}
permissions: ['network']
trigger: undefined
```

**How the host uses this architect:**
1. Host calls `architect.generateProtocol(task, moduleDescriptions)` → returns `TaskProtocol`
2. For each step, host sends `step.description` directly to the executor module's `execute` tool
3. No sandbox, no code execution, no GlobalVars
4. Executor output becomes the step result
5. On all steps done, host marks task DONE

This is the lightest-weight architect. Cheapest LLM calls (no code generation). Fastest execution. Only works when executors are fully autonomous.

#### architect-planner (future)

```
description: "Meta-planning architect. I produce step plans where
  some steps have code and some are descriptions. I decide per-step
  which approach to use.

  For steps that need local logic (artifact manipulation, GlobalVars,
  conditional branching, multi-API orchestration), I generate code.
  For steps that are pure delegation to an autonomous executor, I
  produce just a description.

  I am the most flexible architect but also the most expensive —
  I need a larger context window and more sophisticated reasoning.

  Best for: mixed tasks combining local work and remote delegation.
  Example: 'analyze the codebase locally (code), then delegate
  implementation to Jules (description), then run tests locally (code)'."

outputType: 'protocol+code'

requiresBindings: '*'

tools: []
sandboxBindings: {}
permissions: ['network']
trigger: undefined
```

**How the host uses this architect:**
1. Host calls `architect.generateProtocol(task, moduleDescriptions)` → returns `TaskProtocol` where each step has an optional `code` field
2. For steps with `code`: host runs in sandbox as usual
3. For steps without `code`: host sends `step.description` to the executor directly
4. Mixed execution within a single task

#### architect-dag (future)

```
description: "DAG-based architect. I produce a dependency graph of steps,
  not a linear list. Each step declares which other steps it depends on
  (dependsOn: string[]). The host runs independent steps in parallel
  and waits for dependencies before starting dependents.

  I also produce a verification prompt per step — what the output should
  look like. The host passes this to the executor's verifyFn for
  result validation.

  Best for: tasks with natural parallelism — 'write tests for module A'
  and 'write tests for module B' don't depend on each other and should
  run concurrently. Also for multi-executor fan-out: send same subtask
  to multiple executors, take first result (Promise.race).

  NOT for: simple sequential tasks where architect-codegen-full suffices.
  The DAG adds complexity — only use when parallelism matters.

  Output shape: each step has dependsOn (step IDs), executor, description,
  code (optional), and verification (criteria string)."
```

**Example DAG for "Refactor auth module":**

```
Step A: "Read current auth code"          (dependsOn: [])
Step B: "Write JWT middleware"            (dependsOn: ["A"])
Step C: "Write session middleware"        (dependsOn: ["A"])
Step D: "Integration tests"              (dependsOn: ["B", "C"])
Step E: "Update README"                  (dependsOn: ["B"])
```

Host runs A first, then B+C in parallel (Promise.all), then D+E in parallel.

**How the host uses this architect:**
1. Host calls `architect.generateProtocol(task, moduleDescriptions)` → returns `TaskProtocol` with `dependsOn` on each step
2. Host builds a DAG from `dependsOn` edges
3. Topological sort → identify parallelizable groups
4. Execute each group: `Promise.all(stepsInGroup.map(runStep))`
5. Each step has `verification` criteria passed to the executor negotiator's `verifyFn`
6. If a step fails, all dependents are marked `failed` too (cascade)

**Open gaps (to resolve before implementation):**
- **GlobalVars concurrency:** parallel steps writing to the same GlobalVars keys can race. Options: per-branch isolated GlobalVars with merge on completion, or architect ensures parallel steps write to disjoint keys. Decision pending.
- **Cycle detection:** host must validate the DAG has no cycles before execution. Simple topological sort check.
- **Partial failure:** when one of N parallel steps fails, do all siblings abort, or do they finish? Cascade rule says dependents fail, but siblings may be independent. Needs clear semantics.

### 8.1.1 Architect Selection

The host must decide which architect to use for each task. Options:

**Option A: Manual.** User picks the architect when creating the task. Simple, explicit, but adds UX friction.

**Option B: Auto-routed by architect description.** A lightweight "meta-architect" (or just a simple LLM call) reads the task and the available architect descriptions, picks the best fit. Same pattern as executor routing.

**Option C: Escalation.** Start with `architect-codegen-simple`. If it throws ("too complex"), fall back to `architect-codegen-full`. If the task is 100% delegation, use `architect-describer`. Automatic, no user input needed.

Recommended: **Option C** with manual override. The host tries simple first, escalates if needed. User can force a specific architect via task metadata.

### 8.1.2 Architect Module Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Host (Orchestrator)                           │
│                                                                      │
│  1. Pick architect module (auto-route or manual)                     │
│  2. Collect all sandbox bindings from all registered modules         │
│  3. Call architect.generateProtocol(task, modules) → TaskProtocol    │
│  4. For each step:                                                   │
│     a. If architect output includes code:                            │
│        - Call architect.generateCode(task, step, ...) → code string  │
│        - Inject all modules' sandbox bindings into sandbox           │
│        - Execute code in sandbox (worker)                            │
│        - On error: retry with error context                          │
│     b. If step is description-only:                                  │
│        - Send step.description to executor module's execute tool     │
│        - Wait for result                                             │
│  5. On all steps done: mark task DONE                                │
│                                                                      │
│  ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐ │
│  │  Architect Worker │   │  Sandbox Worker   │   │  Module Workers   │ │
│  │                  │   │                  │   │                  │ │
│  │ generateProtocol│   │  Runs generated  │   │  askJules()      │ │
│  │ generateCode    │   │  code with       │   │  askUser()       │ │
│  │                  │   │  injected APIs   │   │  Artifacts.*     │ │
│  └──────────────────┘   └──────────────────┘   └──────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

The architect worker and sandbox worker are separate. The architect generates code, the sandbox runs it. This means:
- Architect crash doesn't kill running code
- Sandbox crash doesn't kill the architect (it can regenerate)
- Both are isolated from the main thread

#### executor-jules

Current code: `src/services/negotiators/JulesNegotiator.ts` + `src/services/JulesSessionManager.ts` + `src/App.tsx` (Jules Postman, lines 250-419)

This is a **dual-role module**: executor (called by architect) + process (manages sessions in background). Currently, session lifecycle is split between `JulesSessionManager` (shared utility), `JulesNegotiator` (steering loop), and the App.tsx Postman (polling/classification). In the module world, `executor-jules` owns all of this end-to-end.

```
description: "Fully autonomous coding agent in a cloud VM. Give it large
  ambitious tasks — do not micromanage. Async: JNA sends prompt, polls
  for activities, then enters a steering loop — verifies output against
  successCriteria via LLM, sends specific feedback about what failed,
  waits for next response, repeats until verified. Not a 3-retry limit —
  it steers Jules iteratively until the result is correct.
  Strictly limited to repo ops — no artifact management.
  Latency: minutes. Cost: paid per session.

  SESSION REUSE: I can reuse an existing session for follow-up work on the
  same repo/branch. A reused session already has context — files read,
  decisions made, code structure loaded. This means:
  - Reused sessions are 'free' — they don't count against the daily new-session quota.
  - Reused sessions degrade over time. As context accumulates, Jules may:
    * Lose track of earlier instructions (context window pressure)
    * Produce lower-quality output (conflicting instructions layer up)
    * Take longer (more history to process)
  - The JNA handles degradation detection: if a reused session's output quality
    drops (verification fails repeatedly), the JNA abandons it and requests a
    fresh session (which counts against the daily quota).
  - Think of it like a developer who's been in the same codebase for 8 hours —
    still productive, but increasingly scattered. Fresh eyes cost a quota slot.

  CONCURRENCY: I can only run ONE session at a time per Jules account. This is
  a hard platform limit, not configurable. If two steps both need Jules, they
  serialize. The architect should prefer parallelizing with other executors
  (e.g. WASM for local work, Jules for the one thing that needs intelligence)."

type: executor

tools:
  - executor-jules.execute
      params: { prompt: string, successCriteria: string }
      Full steering cycle: send to Jules, poll, verify, feed back, repeat.
      Reuses existing session if one is available for this repo/branch.
      Falls back to new session if none exists or degradation detected.
      Returns final verified output on success, throws on persistent failure.

  - executor-jules.manageSessions
      params: {}
      Background tick: scan all known sessions, wake sleeping ones that
      have new activity, detach completed/failed sessions from tasks,
      recycle idle sessions, detect degraded sessions for replacement.

  - executor-jules.listSessions
      params: { taskId?: string }
      List sessions for presentation panel. Used by fetchData in presentations.

  - executor-jules.cancelSession
      params: { sessionId: string }
      Cancel a running session. Used by presentation actions.

sandboxBindings:
  "askJules": "execute"
  // Programmer writes: const result = await askJules(prompt, criteria);

trigger:
  type: cron
  schedule: "*/5 * * * * *"   // every 5 seconds — replaces App.tsx Postman loop

processTick: "manageSessions"

limits:
  - resource: concurrent
    limit: 1
    period: concurrent
    description: "1 concurrent Jules session per account (platform hard limit)"
  - resource: newSessions
    limit: 10
    period: day
    description: "10 new sessions per day (reused sessions don't count)"

configFields:
  - key: apiKey
    type: string
    label: Jules API Key
    secret: true
    required: true
    description: "Google AI API key for Jules. Stored encrypted."
  - key: pollInterval
    type: number
    label: Poll interval (ms)
    default: 5000
    description: "How often to poll Jules for activity updates."
  - key: degradationThreshold
    type: number
    label: Degradation threshold (failed verifications)
    default: 3
    description: "Consecutive verification failures on a reused session before abandoning it for a fresh one."

permissions: [network]   // polls Jules API, calls LLM for verification

presentations:
  - id: sessions
    type: list
    label: Jules Sessions
    icon: cloud
    fetchData: listSessions
    actions:
      - id: cancel
        label: Cancel
        tool: cancelSession
        confirm: "Cancel this Jules session?"
        variant: danger
      - id: viewLogs
        label: View Logs
        tool: listSessions   // opens log detail
        variant: default
```

**Session Lifecycle: Reuse, Degradation, Limits**

Jules sessions have three distinct resource concepts:

| Concept | Type | How enforced |
|---------|------|-------------|
| **Concurrent sessions** | Hard platform limit | Host blocks new `execute` calls when a session is active. Queues or rejects. |
| **New sessions per day** | Platform quota | Host counts new sessions created today. Reuse is free. |
| **Session quality** | Soft degradation | JNA tracks consecutive verification failures per session. Exceeds threshold → abandon, create fresh (counts against daily quota). |

```
Session states:

NEW ──> ACTIVE ──> REUSED ──> DEGRADED ──> ABANDONED
          │                      │
          │    (verification     │  (threshold exceeded,
          │     passes)          │   start fresh session)
          │                      │
          └──> COMPLETED         └──> new session counts
               (detach from           against daily quota
                task, keep for
                reuse)
```

**Why `limits` is schema, not `description`:** The host enforces concurrent and daily-new limits programmatically. When `execute` is called, the host checks: "is a session already running? have we hit 10 new today?" These are boolean gate checks, not LLM reasoning. The degradation threshold is also programmatic — the JNA counts failures and acts when the count hits the limit. These belong in structured schema because code runs them, not an LLM.

**What stays in `description`:** The *nature* of degradation (context window pressure, quality drop, conflicting instructions), the *analogy* (tired developer), the *recommendation* to architects (prefer parallelizing with other executors). The LLM reads this to make routing decisions.

**What this replaces:**
- `JulesSessionManager` static class → internal to `executor-jules` worker
- `App.tsx` Postman loop (lines 250-419) → `manageSessions` processTick
- `JulesNegotiator` steering logic → internal to `execute` tool
- `julesApiKey` in localStorage → `configFields.apiKey`, stored in central `ModuleConfig`
- Direct `julesApi` calls → all go through the module worker

**JNA Steering Loop** (replaces current 3-retry pattern in `JulesNegotiator.ts`):

Current code is wrong: it takes the first response, verifies, retries up to 3 times with generic "try again" feedback. The correct pattern is an iterative steering loop:

```typescript
// verifyFn returns structured feedback, not just boolean
type VerifyResult = {
  passed: boolean;
  feedback?: string;  // "Missing error handling for null input"
};

async function negotiate(
  julesApiKey: string,
  task: Task,
  prompt: string,
  successCriteria: string,
  verifyFn: (output: string, criteria: string) => Promise<VerifyResult>
): Promise<string> {
  // 1. Send initial prompt
  await sendToJules(prompt);

  // 2. Steering loop — iterate until verified or unrecoverable
  let iteration = 0;
  const maxIterations = 20;  // generous — real limit is verification passing

  while (iteration < maxIterations) {
    // 3. Wait for Jules response
    const response = await pollForResponse();

    // 4. Verify — returns specific feedback, not just true/false
    const result = await verifyFn(response, successCriteria);

    if (result.passed) {
      return response;  // done — verified output
    }

    // 5. Steer: send specific feedback about what failed
    iteration++;
    await sendToJules(
      `Your output did not meet the criteria. Specific issue: ${result.feedback}. Please fix and try again.`
    );
  }

  throw new Error(`Jules failed verification after ${maxIterations} steering iterations.`);
}
```

Key differences from current code:
- **No hard 3-retry limit** — loops until verified (with safety cap)
- **Specific feedback, not generic** — the verifier explains *what* failed, Jules gets smarter direction each iteration
- **verifyFn returns `VerifyResult`, not `boolean`** — must explain why it failed, not just that it failed
- **Each iteration is a steering message, not a retry** — Jules builds on previous context

#### executor-wasm (future)

```
description: "Local WASM busybox with repo mounted as filesystem. Give me
  exact commands — I am NOT autonomous. Synchronous, returns stdout/stderr
  immediately. Fast (ms), free. Use for: grep, file reads, test runs,
  small scripts."

tools:
  - executor-wasm.execute
      params: { prompt: string }
      synchronous. Returns { stdout, stderr, exitCode }.

  - executor-wasm.writeFile
      params: { path: string, content: string }
      Write a file in the sandboxed filesystem.

  - executor-wasm.readFile
      params: { path: string }
      Read a file from the sandboxed filesystem.

sandboxBindings:
  "askWasm": "execute"
  "wasmReadFile": "readFile"
  "wasmWriteFile": "writeFile"
  // Programmer writes: const out = await askWasm("grep -r TODO src/");
```

#### executor-openclaude (future)

```
description: "Semi-autonomous agent running as a local Claude session.
  Give me medium-grained tasks — I can handle multi-file edits and
  reasoning but work best with a clear scope. Conversation-based:
  I maintain context across calls within a session. Async with
  streamed progress."

tools:
  - executor-openclaude.execute
      params: { prompt: string }
      async. Returns streamed progress events, final result on completion.

sandboxBindings:
  "askClaude": "execute"
```

#### executor-github (future)

Uses GitHub Actions VMs as disposable compute. Pushes workflow + code to a temp branch, triggers `workflow_dispatch`, polls the run, downloads the artifact.

```
description: "Remote dumb executor using GitHub Actions VMs. Give me code
  and a workflow — I run it in an isolated VM, return the output artifact.
  Cold start ~30s. Free VMs (2-core, 7GB, 6h timeout). Good for: builds,
  test suites, data processing, linting. NOT for quick synchronous calls
  or autonomous intelligent work. I just run what you give me."

type: executor

tools:
  - executor-github.execute
      params: { workflow: string, code: string, artifactPath: string }
      Pushes workflow YAML + code to temp branch, triggers dispatch,
      polls until complete, downloads artifact. Returns artifact content.

  - executor-github.manageRuns
      params: {}
      Background tick: scan running workflows, timeout stale ones,
      clean up temp branches from completed runs.

sandboxBindings:
  "askGithub": "execute"

trigger:
  type: cron
  schedule: "*/30 * * * * *"   // every 30 seconds

processTick: "manageRuns"

configFields:
  - key: token
    type: string
    label: GitHub Token
    secret: true
    required: true
    description: "Personal access token with repo and actions permissions."
  - key: repo
    type: string
    label: Repository
    required: true
    description: "owner/repo for running workflows."

permissions: [network]   // GitHub API calls
```

#### executor-docker-local (future)

Runs code in a local Docker container. Builds a Dockerfile, runs it, extracts output. No network, no API keys — just Docker.

```
description: "Local dumb executor using Docker containers. Give me a
  Dockerfile and code — I build an image, run it, return stdout and any
  output artifacts. Fast if image is cached (~1s), slower on first build.
  Use for: running code that needs a real OS, real filesystem, real CLI
  tools — anything WASM can't handle. I am NOT autonomous."

type: executor

tools:
  - executor-docker-local.execute
      params: { dockerfile: string, code: string, outputDir?: string }
      Builds image, runs container, extracts output. Returns { stdout, stderr, artifacts }.

sandboxBindings:
  "askDocker": "execute"

configFields:
  - key: imageCache
    type: boolean
    label: Cache built images
    default: true
  - key: timeout
    type: number
    label: Container timeout (seconds)
    default: 300

permissions: []   // uses host RPC for Docker, no direct system access
```

#### executor-serverless (future, ideation)

The hardest variant. Who builds the container image? Three approaches:

1. **Pre-built images** (V1): Module ships with template images (python-runner, node-runner, go-runner). Executor picks the right image, mounts code, invokes. Simple but inflexible.

2. **Build-on-deploy** (V2): Module generates a Dockerfile, pushes to a registry, deploys as Cloud Run / Lambda / Functions. Needs registry credentials, build pipeline, cleanup. Complex.

3. **Function-only** (V3): Skip containers. Upload JS/WASM to Lambda, invoke, get result. Limited to function runtime constraints.

**Deferred** — no concrete use case yet that GitHub Workflows or local Docker can't cover. Add when needed.

#### knowledge-artifacts

Current code: `src/services/ArtifactTool.ts`

```
description: "Stores and retrieves named artifacts — design specs, research
  notes, code analysis, any text data. Artifacts are scoped to repo+branch
  and optionally to a specific task. Cross-task sharing enabled: the agent
  can discover artifacts from other tasks on the same repo/branch.
  Files prefixed with '_' are private to the owning task.
  This is the ONLY authorized way to store task-related artifacts."

tools:
  - knowledge-artifacts.listArtifacts
      params: { taskId?: string, repo_name?: string, branch?: string }
      Lists artifacts. No filters = all for current repo/branch.

  - knowledge-artifacts.readArtifact
      params: { artifactId: number }
      Returns full artifact content.

  - knowledge-artifacts.saveArtifact
      params: { name: string, content: string }
      Creates a new artifact. Returns the artifact ID.

sandboxBindings:
  "Artifacts": <entire object>  // already injected as ArtifactTool in current code
  // Programmer writes: const id = await Artifacts.saveArtifact(name, content);
```

#### knowledge-repo-browser

Current code: `src/services/RepositoryTool.ts`

```
description: "Read-only browser for the Git repository. Can list files,
  read file contents, and inspect file headers. Uses GitHub API (or local
  clone) under the hood. No write access — use an executor for that."

tools:
  - knowledge-repo-browser.listFiles
      params: { path: string }
      Lists files and directories at the given path.

  - knowledge-repo-browser.readFile
      params: { path: string }
      Returns full file content.

  - knowledge-repo-browser.headFile
      params: { path: string, lines?: number }
      Returns the first N lines of a file. Default: 3.

sandboxBindings:
  // Not currently injected into sandbox. Would be added as:
  "Repo": <entire object>
  // Programmer writes: const files = await Repo.listFiles("src/services");
```

#### channel-mailbox

Current code: `src/services/negotiators/UserNegotiator.ts`

```
description: "In-app mailbox. Messages appear in the Fleet UI sidebar.
  UNA sends question, updates task state to WAITING_FOR_USER, polls DB
  for reply (2s interval). Supports format validation: if format constraint
  provided, validates user input via LLM. Failed validation throws error
  back to Programmer Agent for retry. Checks for existing identical
  questions to avoid duplicate mailbox entries."

tools:
  - channel-mailbox.askUser
      params: { question: string, format?: string }
      Sends question to mailbox, waits for reply. Validates against format
      if provided. Throws on validation failure.

  - channel-mailbox.sendMessage
      params: { type: 'info'|'proposal'|'alert', content: string,
                title?: string, description?: string }
      One-way message. No reply expected.

sandboxBindings:
  "askUser": "askUser"
  // Programmer writes: const answer = await askUser("Which branch?", "must be a string");
```

#### channel-telegram (future)

```
description: "Telegram bot. Delivers messages and questions to the user's
  Telegram chat. Supports replies. User must configure bot token and
  chat ID. Good for mobile notifications and quick approvals."

tools:
  - channel-telegram.askUser
      params: { question: string, format?: string }
      Sends question to Telegram, waits for reply. Same format validation
      as mailbox.

  - channel-telegram.sendMessage
      params: { type: 'info'|'alert', content: string }
      One-way notification to Telegram. No reply expected.

sandboxBindings:
  "askTelegram": "askUser"
  // Programmer writes: const answer = await askTelegram("Proceed? (yes/no)");
```

### 8.1.3 Process Controllers

Process modules are fundamentally different from the other three categories. They don't expose tools to the sandbox. They don't get called by the architect. They observe the board and act on it — proposing tasks, sending alerts, updating state.

Think of them as **autonomous project managers** that run in the background. The other module types are tools the architect uses. Process modules are agents that use the board.

#### process-project-manager (current)

Current code: `src/services/ProcessAgent.ts` + `src/constants/constitutions.ts` + `src/components/ConstitutionEditor.tsx`

```
description: "Project manager that reviews the entire board state against
  the project constitution. The constitution defines project stages and
  the artifacts expected at each stage (e.g. Discovery → Research Notes,
  Design → Design Spec, Implementation → Code Analysis).

  I identify the current project stage by checking which artifacts exist.
  I propose tasks to fill gaps: missing artifacts, unstarted stages,
  follow-up work from completed tasks. I respect the constitution's rules
  strictly — if the constitution says 'every feature needs a test task',
  I propose test tasks after implementation tasks complete.

  I do NOT execute tasks. I only propose them as messages for user approval.
  I run on schedule, on board changes, or manually."

tools: []   // no tools exposed to architect — process modules are inward-facing

sandboxBindings: {}   // not callable from generated code

permissions: ['network']   // needs LLM API for analysis

trigger:
  primary: 'event'
  events: ['artifact:saved', 'step:complete', 'task:created']
  manual: true   // always available via "Review Board" button — first-class trigger, not fallback
```

**Manual invocation is a first-class trigger.** The ProcessAgent can be called at any time by the user pressing "Review Board" (or programmatically by the host via `runManual(moduleId)`). This is not a fallback — it's an explicit trigger mechanism equal to events and cron. Manual runs produce the same output (proposals in mailbox) and the same module logs as event-triggered runs. This guarantee exists because:

- Board state may have changed in ways not covered by subscribed events
- The user may want a fresh review after editing the constitution
- During debugging or onboarding, manual runs validate that the process module is working

Any process module can declare `manual: true` in its trigger config. The host exposes `runManual(moduleId)` — same entry point as event/cron triggers, same execution path.

**Constitution system** (already exists):

The project constitution is a markdown document stored per repo+branch in IndexedDB. It defines:

1. **Project stages**: ordered list of phases (Discovery → Design → Implementation → Testing → Deployment)
2. **Expected artifacts per stage**: what should exist when a stage is complete
3. **Rules**: constraints the process agent follows ("every feature needs a test", "no deployment without QA sign-off")

Templates ship with the app (default, research, develop, mvp, acceptance). Users edit them in the ConstitutionEditor UI. The constitution is loaded by ProcessAgent at every review run.

**Current ProcessAgent behavior** (`ProcessAgent.ts:27-145`):
1. Read all tasks, artifacts, unread messages from DB
2. Load constitution for this repo+branch
3. Build context: task states, artifact names/contents, unread messages
4. Ask LLM: "based on constitution and current state, what tasks should be proposed?"
5. LLM returns structured proposals: `{ proposals: [{ type, content, proposedTask }] }`
6. Proposals land as unread messages (`sender: 'process-agent'`) in the mailbox
7. User sees proposals in mailbox, accepts or rejects

**What changes as a module**:
- ProcessAgent becomes a worker (not blocking main thread during LLM call)
- Trigger mechanism replaces manual invocation (can still be manual too)
- Event bus replaces direct DB reads (subscribes to board change events)
- Proposals still land as messages (no change to user flow)
- Constitution editor stays in Modules tab UI

#### process-dependency-tracker (future)

```
description: "Watches task completion and artifact production to resolve
  dependencies between tasks. When a task produces an artifact that another
  task needs as input, proposes starting the dependent task.

  Example: Task A produces 'API Design Spec' artifact. Task B requires
  'API Design Spec' as input. When Task A completes and saves the spec,
  I propose starting Task B with a reference to the spec artifact.

  I read task descriptions to infer dependencies — I do not require
  explicit dependency declarations. I look for phrases like 'based on the
  design spec', 'using the API from', 'after the migration is complete'."

trigger:
  type: 'event'
  events: ['step:complete', 'artifact:saved']
```

#### process-regression-guard (future)

```
description: "Enforces the rule: no untested code reaches DONE.
  After every implementation task completes, I check if a corresponding
  test task exists. If not, I propose one.

  I look at completed tasks whose step used an executor that modifies code
  (executor-jules, executor-openclaude, executor-cli with write commands).
  I propose a test task scoped to the same files/modules that were changed.

  I do NOT run the tests myself — I just ensure test tasks exist on the
  board. If a test task already exists for the same scope, I skip."

trigger:
  type: 'event'
  events: ['step:complete']
```

#### process-stale-task-cleanup (future)

```
description: "Detects stalled tasks and proposes action.
  A task is stale if it has been IN_PROGRESS for more than N hours with
  no log activity (no new moduleLogs entries, no state changes).

  For stale tasks, I propose one of:
  - 'Mark as blocked' — escalate to user for direction
  - 'Retry with different executor' — if the current executor seems stuck
  - 'Cancel' — if the task is no longer relevant based on board state

  Stale threshold is configurable (default: 4 hours).
  I never auto-cancel — I only propose. The user decides."

trigger:
  type: 'cron'
  schedule: '0 */4 * * *'   // every 4 hours
```

#### process-milestone-planner (future)

```
description: "Groups completed tasks into milestones based on the
  constitution's stage definitions. When all tasks for a stage are complete
  and all expected artifacts exist, I propose a milestone review task.

  A milestone review task is a meta-task: 'Review all work from the
  Implementation stage. Verify artifacts match expectations. Propose
  next stage tasks.'

  I also detect when a stage is partially complete — some tasks done,
  some not — and propose prioritization messages to the user:
  '3 of 5 Implementation tasks are done. Consider finishing the remaining
  2 before moving to Testing.'

  I read the constitution to know what stages exist and what completion
  looks like for each."

trigger:
  type: 'event'
  events: ['step:complete']
```

#### process-review-synthesizer (future)

```
description: "Watches for accumulation of analysis/research artifacts
  and proposes synthesis when enough material exists.

  Example: 3 separate code analysis artifacts exist from different tasks.
  I propose: 'Synthesize all code analysis findings into a single
  Architecture Decision Record.'

  I look for artifact clusters — multiple artifacts of the same type
  or covering the same module. When a cluster reaches a threshold
  (configurable, default: 3), I propose a synthesis task.

  The synthesis task is assigned to an executor (usually Jules or
  OpenClaude) with all relevant artifact IDs as input."

trigger:
  type: 'event'
  events: ['artifact:saved']
```

#### process-github-webhook (future)

```
description: "Receives GitHub webhooks and creates tasks on the board.
  Listens for: PR opened, issue labeled, CI check failed, new release
  published, review requested.

  For each event, I create a task with appropriate priority and metadata:
  - CI failure → high priority 'Fix CI' task
  - PR opened → 'Review PR #123' task
  - Issue labeled 'bug' → 'Investigate bug: <title>' task
  - Review requested → 'Review PR #123 for <author>' task

  I do NOT assign executors — I just create TODO tasks. The architect
  and the user decide how to handle them.

  Requires a webhook endpoint (server or tunnel)."

trigger:
  type: 'event'
  events: ['webhook:github']   // external event, not board event
```

#### process-cron (future)

```
description: "Time-based task creator. Define scheduled tasks in the
  constitution or in my own configuration. Examples:
  - Every night at 2am: 'Run full test suite'
  - Every Monday: 'Review stale branches'
  - Every sprint start: 'Create sprint planning task'

  I am configured via the constitution's 'Scheduled Tasks' section,
  or via my own config panel in the Modules tab. I read the schedule,
  check if a task already exists for this period, and propose one if not."

trigger:
  type: 'cron'
  schedule: '0 2 * * *'   // configurable per task
```

#### process-file-watch (future)

```
description: "Watches local files or directories for changes and creates
  tasks in response. Useful for:
  - Watching package.json → propose 'update dependencies' when it changes
  - Watching .env.example → propose 'sync .env with template' when it changes
  - Watching a TODO.md → convert new TODO items into board tasks
  - Watching a Slack export → create tasks from action items

  I do NOT watch the git repo — that's knowledge-repo-browser's job.
  I watch project-adjacent files that aren't code."

trigger:
  type: 'event'
  events: ['file:changed']
```

#### process-slack-command (future)

```
description: "Listens for slash commands in a Slack channel and creates
  tasks on the board. Commands:
  - /kanban add 'fix the login bug' → creates TODO task
  - /kanban status → replies with board summary in Slack
  - /kanban urgent 'prod is down' → creates high-priority task, notifies board

  I am a bridge from Slack to the board. I only create tasks — I don't
  execute them. Replies go back to Slack via channel-slack."

trigger:
  type: 'event'
  events: ['slack:command']
```

### 8.1.4 Process Module Architecture

Process modules share a common lifecycle that differs from other module types:

```
┌─────────────────────────────────────────────────────────────┐
│                     Process Module Lifecycle                 │
│                                                              │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌────────┐│
│  │  IDLE    │───>│ TRIGGERED│───>│ RUNNING  │───>│ DONE   ││
│  │          │    │          │    │          │    │        ││
│  │ Waiting  │    │ Event or │    │ Reading  │    │ Props  ││
│  │ for trig │    │ schedule │    │ board,   │    │ sent   ││
│  │          │    │ fired    │    │ calling  │    │ to     ││
│  │          │    │          │    │ LLM,     │    │ mailbox ││
│  │          │    │          │    │ building │    │        ││
│  │          │    │          │    │ props    │    │        ││
│  └──────────┘    └──────────┘    └──────────┘    └────────┘│
│       ^                                              │      │
│       └──────────────────────────────────────────────┘      │
│                                                              │
│  No sandbox bindings. No architect interaction.              │
│  Reads board state, writes proposals.                        │
└─────────────────────────────────────────────────────────────┘
```

**What process modules can read (via host RPC):**
- All tasks and their state
- All artifacts (content and metadata)
- All messages (read and unread)
- Project constitution
- Module logs from other modules
- Event history

**What process modules can write (via event bus):**
- New task proposals (as messages to mailbox)
- Alerts and notifications (as messages to mailbox)
- Status updates to their own module log

**What process modules CANNOT do:**
- Execute tasks directly
- Modify other tasks' state
- Call other modules' tools
- Modify artifacts
- Send messages to user channels directly (they propose via mailbox)

This keeps process modules as **advisors, not actors**. They recommend. The user (via mailbox approval) or the orchestrator decides whether to act.

### 8.1.5 Process Module vs Policy Module

There's a natural question: is this a `process` module or a `policy` module? They're different:

| | Process | Policy |
|---|---|---|
| **When it runs** | On trigger (event, cron, manual) | At decision points (queried by host) |
| **What it does** | Proposes new tasks, alerts, reviews | Returns yes/no or a value |
| **Analogy** | Project manager | Guard rail |
| **Examples** | "You're missing a test plan, here's a task proposal" | "Don't run more than 10 Jules sessions today" |
| **Initiative** | Self-initiated | Reactive |

Policy modules are NOT a separate type in this proposal. Policy-like behavior can be expressed as:
- **In the constitution** (enforced by process-project-manager): "no deployment without QA sign-off"
- **In executor descriptions** (enforced by the architect's reasoning): "I cost money, use me sparingly"
- **As a process module** (enforced by triggering and proposing): "you've exceeded the Jules session limit, I'm proposing to block further Jules tasks"

If policy modules become necessary as a distinct type later (because querying at decision points is different from proposing tasks), they can be added as a 6th module type with the same manifest structure but a `policy` interface instead of tools.

Stored as manifests in IndexedDB. Loaded from a git repo URL + ref.

```typescript
interface ModuleRegistry {
  // All loaded modules (bundled + installed)
  getAll(): ModuleHost[];

  // Get by ID
  get(id: string): ModuleHost | undefined;

  // Get by type
  getByType(type: ModuleManifest['type']): ModuleHost[];

  // Install a new module from a manifest URL
  install(manifestUrl: string): Promise<void>;

  // Remove an installed module
  uninstall(id: string): Promise<void>;

  // Start all modules
  startAll(): Promise<void>;

  // Stop all modules
  stopAll(): Promise<void>;
}
```

### 8.2 Install Flow

User provides a manifest URL (which can point to a GitHub raw file). The registry:
1. Fetches the manifest JSON
2. Validates structure and required fields
3. Checks permissions — prompts user for approval if module requests network/FS access
4. Clones/fetches the module bundle from `source.repoUrl` at `source.ref` (see [modules-spec.md](modules-spec.md) §4.7.1 for multi-source resolution)
5. Stores the manifest in IndexedDB
6. Loads the module in a worker
7. Module appears in sidebar (knowledge), executor list (executor), or channel list (channel)

### 8.3 Future Module Catalog

Modules that don't exist yet but are natural extensions. None of these require core code changes — each is a new folder with a manifest.

#### Architect Modules

| Module | outputType | What it does |
|--------|-----------|-------------|
| `architect-codegen-simple` | `'code'` | Single code block, no step planning. Fast, cheap. For simple tasks. |
| `architect-describer` | `'protocol'` | Step descriptions only, no code. Pure delegation to autonomous executors. |
| `architect-planner` | `'protocol+code'` | Mixed: code for local steps, descriptions for delegation. Most flexible, most expensive. |
| `architect-researcher` | `'code'` | Specialized for research tasks. Reads knowledge modules, writes artifacts. Never delegates to executors. |
| `architect-reviewer` | `'protocol'` | Specialized for code review. Reads artifacts + repo, produces review steps delegated to OpenClaude. |
| `architect-dag` | `'protocol+code'` | Produces dependency graph (dependsOn edges), not linear list. Host runs parallel steps concurrently. |

#### Knowledge Sources

| Module | What it does |
|--------|-------------|
| `knowledge-jira` | Search and read Jira issues. Architect can pull context from tickets. Tools: `searchIssues(query)`, `getIssue(id)`, `getComments(id)`. |
| `knowledge-notion` | Read Notion pages/databases. Pull specs, meeting notes, decisions. Tools: `getPage(id)`, `queryDatabase(dbId, filter)`. |
| `knowledge-web` | `fetch(url)` + extract text. Read docs, API references, Stack Overflow. Programmable browser for the architect. Tools: `fetchPage(url)`, `extractLinks(url)`. Permissions: `['network']`. |
| `knowledge-git-log` | `git log`, `git blame`, `git diff`. History-aware knowledge. "Who wrote this function and when?" Tools: `log(options)`, `blame(path)`, `diff(from, to)`. |
| `knowledge-env` | Read `.env`, `package.json`, `tsconfig.json`. Project configuration knowledge. Tools: `readConfig(path)`, `listDependencies()`. |
| `knowledge-vector` | Local embedding-based search over the codebase. "Find all files related to authentication." Semantic grep. Tools: `index()`, `search(query, topK)`. |
| `knowledge-deps` | Dependency graph: "which files import this module?", "what does this module depend on?" Static analysis. Tools: `dependents(path)`, `dependencies(path)`, `graph()`. |
| `knowledge-cache` | Memoization layer. Modules can cache expensive results (API responses, analysis) with TTL. Architect can check if something was already computed. Tools: `get(key)`, `set(key, value, ttl)`, `has(key)`. |
| `knowledge-metrics` | Code metrics: test coverage, bundle size, type errors. Read from CI or local tools. Tools: `getCoverage()`, `getBundleSize()`, `getTypeErrors()`. |

#### Executors

| Module | What it does |
|--------|-------------|
| `executor-cli` | Local shell. Like WASM but real processes. `git`, `npm test`, `docker build`. Dumb, synchronous, returns stdout. Permissions: `['network']` if it needs to pull/push. Negotiator: no. |
| `executor-browser` | Playwright/Puppeteer in a worker. Navigate, screenshot, extract text from running apps. "Open localhost:3000 and verify the login form renders." Negotiator: no (synchronous, deterministic). |
| `executor-sql` | Connect to a database, run queries, return results. Dumb executor for data tasks. "Count users created this week." Negotiator: no. |
| `executor-image` | Image generation/manipulation. DALL-E, Stable Diffusion, or simple ImageMagick. "Generate an icon for this feature." Negotiator: yes (LLM verifies output matches request). |
| `executor-lint` | Run linters and formatters. Faster than WASM for code quality checks because it has the real toolchain. Negotiator: no. |

#### User Channels

| Module | What it does |
|--------|-------------|
| `channel-email` | Send questions via email, receive replies. For async, low-urgency communication. `Promise.race` compatible. |
| `channel-slack` | Slack bot. Send messages to a channel or DM. Good for team visibility. `Promise.race` compatible. |
| `channel-sms` | Twilio. For urgent on-call alerts. "Production deploy failed, approve rollback?" `Promise.race` compatible. |
| `channel-webhook` | Generic outgoing webhook. POST the question to any URL, expect a response. Lets the user plug in any system. |
| `channel-voice` | Text-to-speech + speech-to-text. Ask a question, user replies by voice. Edge case but fun. |
