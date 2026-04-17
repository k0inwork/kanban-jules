# Proposed Testing Areas

With the Knowledge Base (`kb-part`) almost fully test-covered, we should expand our test coverage to other critical components of the application. The goal is to improve the reliability of core systems, isolated execution environments, UI components, and the orchestrator's module integrations.

Here are the proposed testing areas, what to test, and how to test them.

## 1. Core Services & Filesystem Operations (`src/services/GitFs.ts`)
While there are existing tests for `GitFs.ts`, they are currently failing due to unmocked HTTP responses (e.g., `isomorphic-git` attempting real fetch calls that fail because of missing mocks for response objects).
- **What to test:**
  - Mocking network requests for Git operations (clone, fetch, push) to verify that `isomorphic-git` behaves correctly when resolving refs or failing network boundaries.
  - Ensuring URL constructions (e.g., parsing `sources/github/owner/repo`) accurately build remote URLs.
  - Error handling for invalid credentials, missing repositories, or network timeouts.
- **How to test:**
  - Use `vitest` with `vi.mock()` to stub out `isomorphic-git/http/web/index.js` or intercept `fetch` calls so `arrayBuffer()` and HTTP semantics are handled properly.
  - Write test cases verifying correct fallback logic for Git clone failures (verifying the error cases throw correctly without hitting real servers).

## 2. Sandbox Execution Environment (`src/core/sandbox.test.ts`)
The current tests for the JS sandbox are failing in the `vitest` environment because the execution context (like Web Workers or isolated node scopes) is lacking proper support in `jsdom`.
- **What to test:**
  - Execution of basic sandboxed JavaScript code.
  - Integration of injected APIs (e.g., logging or mock filesystem objects) into the isolated scope.
  - Proper fulfillment or rejection of asynchronous execution streams.
- **How to test:**
  - Use Node's `vm` module or a properly mocked global `Worker` in `vitest.setup.ts` to mimic browser-level Web Workers.
  - Write parameterized tests feeding distinct JS payloads (sync, async, syntax errors) to assert the sandbox securely captures output and errors without leaking to the host.

## 3. Frontend Views & UI Components (`src/components`, `src/App.tsx`)
Currently, UI logic primarily relies on high-level E2E tests via Playwright (`e2e/`), with little to no component-level unit testing.
- **What to test:**
  - State transitions in React components (e.g., what happens when task execution completes or a workflow changes state).
  - Proper rendering of context maps, markdown rendering, and agent chat views.
  - Component responses to mock Dexie DB events or store changes.
- **How to test:**
  - Introduce `@testing-library/react` and `@testing-library/user-event` to render components in the `jsdom` test environment.
  - Stub `IndexedDB` and React context providers to verify UI rendering without spinning up Playwright instances.

## 4. Terminal & WebAssembly Management (`src/modules/channel-wasm-terminal`)
Terminal integration represents one of the most complex parts of the system and needs isolation tests beneath the current Playwright E2E.
- **What to test:**
  - Correct formatting, byte conversion, and batching of `#console/data` payloads over the serial bridge.
  - Lifecycle management of the v86 Wasm VM (booting, shutting down, port conflicts).
- **How to test:**
  - Write unit tests using `vitest` to mock the MessageChannel used for Web Worker communication.
  - Assert that specific command outputs trigger the corresponding event listeners in `TerminalService.ts`.

## 5. Executors and Module Interfaces (`src/modules/executor-*`, `src/modules/process-*`)
While the Orchestrator has extensive integration tests (`integration.test.ts`), the specific executors (Jules, Github, Local, etc.) need isolated unit checks to ensure proper execution routing.
- **What to test:**
  - The parameter construction of executor prompts (e.g., how the `executor-jules` converts task definitions into JNA/UNA prompts).
  - Validation of external MCP actions before they are executed.
- **How to test:**
  - Use `vitest` to isolate individual executor classes. Stub the `llmCall` and filesystem interfaces.
  - Verify prompt payload integrity and ensure that JSON outputs from LLM mocks trigger the expected deterministic actions via the executor boundary.
