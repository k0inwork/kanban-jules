# Module System: Testing Strategy

> Sub-document of [modules.md](modules.md) — the unified capability model proposal.
> This file covers the testing strategy for all module types.

---

## 15. Testing Strategy

Every module type has different external dependencies. A testing suite must emulate those dependencies so modules can be tested in isolation — no real LLM calls, no real Jules sessions, no real user mailbox.

### 15.0 Core Principle: Mock at the Boundary

Modules have two boundaries: **host RPC** (what the module calls to talk to the system) and **external services** (what the module calls to talk to the outside world). Tests mock both.

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│   Test       │      │   Module    │      │   Mock      │
│   Runner     │─────>│   Worker    │─────>│   Host RPC  │
│              │      │             │      │   (in-proc) │
│  asserts     │<─────│  real code  │<─────│  faked DB,  │
│              │      │             │      │  events     │
└─────────────┘      └─────────────┘      └─────────────┘
                            │
                            v
                     ┌─────────────┐
                     │   Mock      │
                     │   External  │
                     │   Services  │
                     │             │
                     │  fake Jules │
                     │  fake LLM   │
                     │  fake GH    │
                     └─────────────┘
```

In practice, modules don't run in workers during tests — the `ModuleWorker.handleRequest` function is called directly. Workers are a deployment detail, not a test concern.

### 15.1 Test Harness: `MockHost`

A shared test utility that simulates the host environment. Every module test uses it.

```typescript
class MockHost {
  private db: MockDatabase;          // in-memory Dexie fake
  private events: SystemEvent[];     // captured events
  private responses: Map<string, any>; // canned responses per method

  // Module calls host.request('readTask', {id}) → returns canned data
  respondTo(method: string, data: any): void;

  // Module calls eventBus.emit({type: 'module:log', ...}) → captured here
  getEvents(type?: string): SystemEvent[];

  // In-memory DB for knowledge/channel modules that read/write state
  getDb(): MockDatabase;

  // Create a module instance wired to this mock host
  loadModule(manifest: ModuleManifest): ModuleWorker;
}
```

**Fixtures** — standard test data shared across all module tests:

```typescript
const fixtures = {
  task: { id: 't1', title: 'Test Task', description: 'Fix the auth bug', workflowStatus: 'IN_PROGRESS', agentState: 'EXECUTING' },
  protocol: { steps: [
    { id: 1, title: 'Investigate', description: 'Find the bug', executor: 'executor-jules', status: 'pending' },
    { id: 2, title: 'Fix', description: 'Fix the bug', executor: 'executor-jules', status: 'pending' }
  ]},
  artifact: { id: 1, taskId: 't1', name: 'analysis.md', content: '# Analysis\n...', repoName: 'my-repo', branchName: 'main' },
  message: { id: 1, sender: 'user', taskId: 't1', content: 'Yes, proceed', status: 'unread', timestamp: Date.now() },
};
```

### 15.2 Per-Module-Type Testing

#### Architect Modules

**What to test:** Given a task description and available module descriptions, does the architect produce a valid protocol? Given a step and context, does it produce executable code?

**What to mock:** The LLM. Architects always call the LLM — that's their job. Tests provide canned LLM responses.

```typescript
// Mock LLM that returns predictable responses
class MockLLM {
  private nextResponse: string;

  setResponse(text: string): void { this.nextResponse = text; }

  async generate(prompt: string): Promise<string> {
    return this.nextResponse;
  }
}

// Test: architect produces valid protocol
const host = new MockHost();
const mockLlm = new MockLLM();
mockLlm.setResponse(JSON.stringify({ steps: [
  { id: 1, title: 'Step 1', description: 'Do X', executor: 'executor-jules', status: 'pending' }
]}));

const architect = loadArchitect('architect-codegen-full', { llm: mockLlm });
const protocol = await architect.handleRequest('generateProtocol', {
  task: fixtures.task,
  modules: [julesManifest, wasmManifest]
});

assert(protocol.steps.length === 1);
assert(protocol.steps[0].executor === 'executor-jules');
```

**Test cases for architects:**

| Case | Input | Assert |
|------|-------|--------|
| Simple delegation | "Ask Jules to fix the bug" | Protocol with 1 step, executor = `executor-jules` |
| Multi-step | "Analyze codebase, then implement, then test" | Protocol with 3 steps, correct executor assignment |
| Error recovery | Code that throws `ReferenceError` | Architect rewrites code with error context in prompt |
| Invalid LLM output | LLM returns garbage JSON | Architect falls back or throws gracefully |
| Code generation | Step + GlobalVars + APIs | Produced code is parseable JS |
| Context forwarding | Step 2 after analyze() in step 1 | Step 2 prompt contains accumulatedAnalysis |

#### Executor Modules

**What to test:** The negotiator loop. Does it send the right prompts, poll correctly, verify output, steer on failure?

**What to mock:** The external service (Jules API, OpenClaude session) and the verification LLM.

```typescript
// Mock Jules — simulates a Jules session with scripted responses AND
// session lifecycle failures (sleeping, data loss, session limits)
class MockJules {
  private responses: string[] = [];
  private callIndex = 0;
  private sentMessages: string[] = [];

  // Session lifecycle state
  private sessionState: 'active' | 'sleeping' | 'failed' | 'data_lost' = 'active';
  private sessionHistory: string[] = [];  // what Jules "remembers" (can be wiped)
  private activityCount = 0;
  private maxActivitiesBeforeSleep?: number;
  private activitiesUntilDataLoss?: number;

  // Queue responses Jules will "send"
  queueResponse(text: string): void { this.responses.push(text); }

  // Session lifecycle controls
  sleepAfter(n: number): void { this.maxActivitiesBeforeSleep = n; }
  loseDataAfter(n: number): void { this.activitiesUntilDataLoss = n; }
  failSession(): void { this.sessionState = 'failed'; }

  // Jules API mock
  async getSession(): Promise<{ state: string }> {
    if (this.sessionState === 'data_lost') {
      // Data was lost but session still exists — Jules has no memory of previous work
      return { state: 'ACTIVE' };
    }
    return { state: this.sessionState === 'sleeping' ? 'IDLE' : 'ACTIVE' };
  }

  async listActivities(): Promise<Activity[]> {
    this.activityCount++;

    // Simulate sleeping — no activities until woken
    if (this.sessionState === 'sleeping') return [];

    // Simulate data loss — session history wiped, but Jules is still "active"
    if (this.activitiesUntilDataLoss && this.activityCount >= this.activitiesUntilDataLoss) {
      this.sessionHistory = [];  // Jules forgot everything
      this.sessionState = 'data_lost';
    }

    // Simulate falling asleep after N activities
    if (this.maxActivitiesBeforeSleep && this.activityCount >= this.maxActivitiesBeforeSleep) {
      this.sessionState = 'sleeping';
      return [];
    }

    const response = this.responses[this.callIndex++];
    if (!response) return [];
    this.sessionHistory.push(response);
    return [{ agentMessaged: { agentMessage: response }, createTime: new Date().toISOString() }];
  }

  async sendMessage(prompt: string): Promise<void> {
    this.sentMessages.push(prompt);
    this.sessionHistory.push(`[user] ${prompt}`);

    // Sending a message wakes a sleeping session
    if (this.sessionState === 'sleeping') {
      this.sessionState = 'active';
    }
  }

  // Create a fresh session (restart after data loss)
  async createSession(title: string, prompt: string): Promise<string> {
    this.sessionHistory = [prompt];
    this.sessionState = 'active';
    this.callIndex = 0;
    this.activityCount = 0;
    return 'new-session-123';
  }

  getSentMessages(): string[] { return this.sentMessages; }
  getSessionHistory(): string[] { return this.sessionHistory; }
  getState(): string { return this.sessionState; }
}

// Test: JNA steering loop — happy path
const mockJules = new MockJules();
const mockVerifyLlm = new MockLLM();

mockJules.queueResponse("I've fixed the auth bug in src/auth.ts. The fix adds null checks to the token validation.");
mockVerifyLlm.setResponse("YES");

const executor = loadExecutor('executor-jules', { jules: mockJules, llm: mockVerifyLlm });
const result = await executor.handleRequest('execute', {
  prompt: 'Fix the auth bug',
  successCriteria: 'Auth bug is fixed with null checks'
});

assert(result.includes('auth.ts'));
assert(mockJules.getSentMessages().length === 0);  // no steering needed

// Test: JNA steering — fail, steer with specific feedback, pass
const mockJules2 = new MockJules();
const mockVerify2 = new MockLLM();

mockJules2.queueResponse("I've started looking at the code.");  // vague, no fix
mockVerify2.setResponse("NO. Missing: actual code changes.");   // first verify

mockJules2.queueResponse("Fixed auth bug in src/auth.ts with null checks.");
mockVerify2.setResponse("YES");  // second verify

const executor2 = loadExecutor('executor-jules', { jules: mockJules2, llm: mockVerify2 });
const result2 = await executor2.handleRequest('execute', { prompt: 'Fix auth', successCriteria: 'Fixed' });

assert(mockJules2.getSentMessages().length === 1);
assert(mockJules2.getSentMessages()[0].includes('Missing: actual code changes'));

// Test: Jules goes to sleep mid-negotiation — JNA should wake it
const mockJules3 = new MockJules();
mockJules3.sleepAfter(1);  // falls asleep after 1 activity poll
mockJules3.queueResponse("Working on it...");

const executor3 = loadExecutor('executor-jules', { jules: mockJules3 });
// JNA polls → 1 activity → Jules sleeps → next poll returns nothing →
// JNA sends wake message → Jules wakes → continues
await executor3.handleRequest('execute', { prompt: 'Fix bug', successCriteria: 'Fixed' });

assert(mockJules3.getState() === 'active');  // was woken
assert(mockJules3.getSentMessages().length >= 1);  // wake message sent

// Test: Jules loses data (session limit hit, data reverted)
// JNA should detect the data loss and restart the session
const mockJules4 = new MockJules();
mockJules4.loseDataAfter(2);  // loses data after 2 activities
mockJules4.queueResponse("Step 1 done.");
mockJules4.queueResponse("Step 2 done.");  // this triggers data loss
mockJules4.queueResponse("Restarted: fixing auth bug from scratch.");  // after restart

const executor4 = loadExecutor('executor-jules', { jules: mockJules4 });
await executor4.handleRequest('execute', { prompt: 'Fix auth', successCriteria: 'Fixed' });

assert(mockJules4.getSessionHistory().length > 0);  // session was restarted with context
```

**Test cases for executor-jules (JNA):**

| Case | Script | Assert |
|------|--------|--------|
| First response passes | Jules returns valid fix, verify = YES | Return result, no steering messages |
| Steer once then pass | First response fails, second passes | 1 steering message with specific feedback |
| Max iterations | Jules always fails verify | Throws after maxIterations, all feedback sent |
| Session reuse | Existing session in DB for task | Reuses session, doesn't create new |
| Session recovery (404) | DB has session, API returns 404 | Deletes stale DB record, creates new |
| Jules sleeps mid-work | `sleepAfter(1)` → no activities returned | JNA sends wake message, Jules resumes |
| Jules loses data | `loseDataAfter(2)` → history wiped | JNA detects data loss, restarts session with original prompt |
| Jules session FAILED | `failSession()` → session state = FAILED | JNA creates new session, doesn't reuse failed one |
| Lost data + restart succeeds | Data lost, restart, Jules completes | Final result returned, restart was transparent to caller |
| Lost data + restart fails | Data lost, restart, max iterations hit | Throws after exhausting restart + steering budget |

**Test cases for executor-wasm (no negotiator):**

| Case | Input | Assert |
|------|-------|--------|
| Run command | `execute({ prompt: "ls src/" })` | Returns `{ stdout, stderr, exitCode }` synchronously |
| Bad command | `execute({ prompt: "rm -rf /" })` | Returns non-zero exitCode |
| Write file | `writeFile({ path, content })` | File exists in virtual FS on next read |

#### Channel Modules

**What to test:** Does the channel send the question, wait for a reply, handle format validation?

**What to mock:** The message store (DB) and the validation LLM. For external channels (Telegram), mock the bot API.

```typescript
// Test: UNA (mailbox channel) — askUser with format validation
const host = new MockHost();
const mockLlm = new MockLLM();

// Simulate user typing a reply after 2 "polls"
let pollCount = 0;
host.respondTo('readMessages', () => {
  pollCount++;
  if (pollCount < 3) return [];  // no reply yet
  return [{ sender: 'user', content: '42', timestamp: Date.now() }];
});

// Format validation: "must be a number" → passes
mockLlm.setResponse('42');

const channel = loadChannel('channel-mailbox', { host, llm: mockLlm });
const result = await channel.handleRequest('askUser', {
  question: 'How many tests?',
  format: 'must be a number'
});

assert(result === '42');

// Test: format validation failure
host.reset();
mockLlm.setResponse('ERROR: "hello" is not a number');
await assertThrows(async () => {
  await channel.handleRequest('askUser', { question: 'Pick a number', format: 'must be a number' });
});
```

**Test cases for channel-mailbox (UNA):**

| Case | Script | Assert |
|------|--------|--------|
| Simple reply | User replies "yes" | Returns "yes" |
| Format validation pass | User replies "42", format "number" | Returns "42" |
| Format validation fail | User replies "hello", format "number" | Throws with validation error |
| Duplicate question | askUser called twice with same question | No duplicate message in DB |
| Existing reply found | Question already asked, reply exists | Returns immediately, no new message |

**Test cases for channel-telegram (future):**

| Case | Script | Assert |
|------|--------|--------|
| Send question | askUser | Bot API called with correct chat ID + question text |
| Receive reply | Telegram webhook delivers text | Returns webhook text |
| Timeout | No reply within TTL | Throws timeout error |

#### Knowledge Modules

**What to test:** CRUD operations, query correctness, access control (private artifacts).

**What to mock:** Only the DB — use a real in-memory Dexie instance (Dexie supports this). No LLM mocking needed for most knowledge modules.

```typescript
// Test: knowledge-artifacts
const host = new MockHost();  // provides in-memory Dexie
const artifacts = loadKnowledge('knowledge-artifacts', { host });

// Save
const id = await artifacts.handleRequest('saveArtifact', {
  name: 'design.md', content: '# Design\n...', taskId: 't1'
});

// List
const list = await artifacts.handleRequest('listArtifacts', { taskId: 't1' });
assert(list.length === 1);
assert(list[0].name === 'design.md');

// Private artifacts
await artifacts.handleRequest('saveArtifact', {
  name: '_internal.md', content: 'private', taskId: 't1'
});
const publicList = await artifacts.handleRequest('listArtifacts', { requestingTaskId: 't2' });
assert(publicList.length === 1);  // _internal filtered out

const ownerList = await artifacts.handleRequest('listArtifacts', { requestingTaskId: 't1' });
assert(ownerList.length === 2);  // owner sees both
```

**Test cases for knowledge modules:**

| Module | Case | Assert |
|--------|------|--------|
| knowledge-artifacts | Save, read, list | Round-trip correctness |
| knowledge-artifacts | Private (`_` prefix) filtering | Other tasks can't see private artifacts |
| knowledge-repo-browser | listFiles | Returns paths, respects path filter |
| knowledge-repo-browser | readFile | Returns content for valid path, error for invalid |

#### Process Modules

**What to test:** Does the process module read board state correctly, produce valid proposals, respect triggers?

**What to mock:** The board state (tasks, artifacts, messages in DB) and the analysis LLM.

```typescript
// Test: process-project-manager proposes missing artifacts
const host = new MockHost();

// Seed board state
host.getDb().tasks.add({ id: 't1', title: 'Build auth', workflowStatus: 'DONE', agentState: 'IDLE' });
host.getDb().taskArtifacts.add({ name: 'Design Spec', content: '...', taskId: 't1', ... });
// No test task exists → process should propose one

const mockLlm = new MockLLM();
mockLlm.setResponse(JSON.stringify({ proposals: [{
  type: 'proposal',
  content: 'Implementation stage has no test task',
  proposedTask: { title: 'Write auth tests', description: 'Test the auth module' }
}]}));

const process = loadProcess('process-project-manager', { host, llm: mockLlm });
await process.handleRequest('run', {});

const messages = host.getDb().messages.toArray();
assert(messages.some(m => m.proposedTask?.title === 'Write auth tests'));
```

**Test cases for process modules:**

| Module | Case | Assert |
|--------|------|--------|
| process-project-manager | Missing stage artifacts | Proposes task to create them |
| process-project-manager | All artifacts present | No proposals |
| process-project-manager | Duplicate proposal | Doesn't propose task already in mailbox |
| process-regression-guard | Implementation done, no test task | Proposes test task |
| process-stale-task-cleanup | Task IN_PROGRESS for 5 hours | Proposes action (block/retry/cancel) |

### 15.3 Integration Tests: Orchestrator → Module

Unit tests cover individual modules. Integration tests cover the full pipeline: architect generates code, host injects sandbox bindings, code runs and calls module tools.

```typescript
// Integration test: full step execution with mock Jules
const harness = new IntegrationHarness();

// Wire up real Orchestrator + real Sandbox + mock modules
harness.registerModule('executor-jules', {
  handleRequest: async (method, args) => {
    if (method === 'execute') return "Fixed auth bug in src/auth.ts";
  }
});

const task = await harness.createTask('Fix the login bug');
await harness.runStep(task, {
  step: { id: 1, title: 'Fix bug', description: 'Fix the login bug using Jules', executor: 'executor-jules' },
  architectCode: `
    const result = await askJules('Fix the login bug', 'Login works correctly');
    return result;
  `
});

assert(harness.getTaskState() === 'IDLE');  // task completed
assert(harness.getModuleLogs('executor-jules').length > 0);
```

**Integration test cases:**

| Case | What it tests |
|------|--------------|
| Happy path | Step executes, task completes |
| Module failure | Executor throws → architect retries with error context |
| askUser in step | Code calls askUser → mock user replies → step continues |
| GlobalVars persistence | Step 1 sets GlobalVars, step 2 reads them |
| spawnSubtask | Code calls spawnSubtask → mock subtask completes → parent resumes |
| analyze forwarding | Step 1 calls analyze() → step 2 prompt contains accumulatedAnalysis |

### 15.4 Test Harness Interface

```typescript
// Shared utilities for all module tests
interface TestHarness {
  // Unit-level: test one module in isolation
  mockHost(): MockHost;
  mockLLM(): MockLLM;
  mockJules(): MockJules;
  mockTelegram(): MockTelegramBot;
  fixtures: typeof fixtures;

  // Integration-level: test the pipeline
  integration(): IntegrationHarness;
}

interface IntegrationHarness {
  registerModule(id: string, mock: Partial<ModuleWorker>): void;
  createTask(title: string): Promise<Task>;
  runStep(task: Task, opts: { step: TaskStep; architectCode?: string }): Promise<void>;
  getTaskState(): AgentState;
  getModuleLogs(moduleId: string): string[];
  getGlobalVars(): Record<string, any>;
}
```

### 15.5 What NOT to Test

- **LLM quality.** Don't assert the architect produces "good" protocols — that's a prompt engineering concern. Assert it produces *valid* (parseable, schema-conforming) output.
- **Real external APIs.** No tests that call the real Jules API, Telegram API, or GitHub API. All external calls are mocked.
- **Worker messaging.** Workers are a deployment detail. Test `handleRequest` directly. If worker RPC breaks, it's an infrastructure bug, not a module bug.
- **UI rendering.** Presentation panels are UI components — tested with React testing tools, not the module test harness.
