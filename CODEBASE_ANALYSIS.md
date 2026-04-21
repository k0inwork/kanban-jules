# Codebase Analysis Report

## 1. Project Overview and Technology Stack

The project is an autonomous agent orchestrator system named "Fleet", designed as a browser-based AI studio application. It employs a multi-agent architecture with clear role separation (Task Architect, Programmer, Specialized Negotiators like JNA, UNA, CNA). The application leverages Model Context Protocol (MCP) to spawn and communicate with external servers.

**Tech Stack:**
- **Frontend:** React 19, Vite 6, Tailwind CSS
- **Persistence:** Dexie (IndexedDB) for local database storage (tasks, agent messages, task artifacts).
- **Backend/Development Server:** Express via `server.ts` running with `tsx`.
- **System Layer:** WebAssembly (WASM) components, featuring a WASM boot layer (Wanix kernel), v86 Linux VM, and multiple Virtual Filesystems (YuanFS, LLMFS, ToolFS, GitFS via isomorphic-git).
- **Code Evaluation:** Sval for JavaScript sandboxing, isolating execution streams from the host.

## 2. Codebase Structure & Key Components

The repository is organized functionally:
- **`src/`:** Contains the main React application, core application logic, components, and services.
  - `components/`: UI components such as Kanban Boards, Artifact Browsers, Setting Modals, and Task detail views.
  - `core/`: Core definitions including Sandbox environments and Constitution System logic (`ARCHITECT_CONSTITUTION`, `PROGRAMMER_CONSTITUTION`).
  - `modules/`: 11 distinct module handlers including `executor-github`, `process-project-manager`, `executor-jules`, and disabled ones like `channel-wasm-terminal`.
  - `services/`: Specialized services, including DB encapsulation (`db.ts`), Virtual File System abstractions (`TaskFs.ts`, `GitFs.ts`, `vfs.ts`), and Local/Process Agents.
- **`wasm/`:** Source code and binaries for the in-browser WASM Linux VM and its components (e.g., `yuanfs.go`, `idbfs/idbfs.go`, `boot/main.go`).
- **`tests/` & `__tests__/`:** Test suites, specifically highlighting Playwright E2E testing setups and vitest unit tests.
- **`server.ts`:** Development server handling API routes like `/api/mcp/execute` and `/api/mcp/tools`.
- **`OVERVIEW_2026-04-13.md`:** Important architectural summary outlining the integration of the `collective` branch containing the fleet orchestrator and WASM executor features.
- **`TESTING_PROPOSAL.md`:** Strategic outline for future testing enhancements, focusing on core services, sandbox execution, UI logic, and Terminal/WASM management.
- **`AGENTS.md` & `CONSTITUTION.md`:** Agent behavioral guidelines and operational rules.

## 3. Architecture Deep Dive

The architectural stack involves a complex interplay between browser environments and sandboxed execution:
1. **Fleet UI:** Built on React and Dexie for state and context persistence.
2. **Orchestrator:** Manages the task lifecycle, selects and dispatches executors, and immediately persists `agentContext` to Dexie on every context change to survive page reloads.
3. **Sandbox (Sval):** Responsible for executing generated JavaScript code. The sandbox restricts access to the DOM/network unless explicitly permitted, routing output and errors safely back to the host.
4. **WASM Boot Layer & VFS:** A robust underlying system enabling advanced local execution, bridging the gap between agent actions and file system mutations natively within the browser, via systems like `YuanFS` (agent bridge) and `idbfs` (persistent filesystem overlay).

## 4. Progress and Evolution Over Time

Examining the recent Git history reveals several major development phases:
- **Foundational Bug Fixes & Stabilization:** Extensive recent commits addressed the initialization and fetching mechanisms associated with GenAI / Gemini APIs. Multiple patches were applied to the application's state management, the `SettingsModal`, and various agent initialization scripts (e.g., `fix_app_gemini.cjs`, `patch_app_state.cjs`).
- **UI Enhancements:** A significant amount of work has been done on constructing a robust monitoring and management interface. This includes building out `KanbanBoard`, `MailboxView`, `GithubWorkflowMonitor`, and complex configuration modals. Most recently, usability tweaks were made, such as making empty project states clickable to open the creation dialog.
- **Agent Communications:** The introduction of an Agent Mail and Chat system design document highlights the focus on improving inter-agent and user-agent communications.
- **The WASM Integration (`feat/wasm-executor`):** A major architectural leap was the merging of the WASM executor layer. This introduced a full in-browser Linux VM environment backed by IndexedDB (`idbfs`) and a virtual filesystem framework, effectively allowing agents to run sophisticated scripts natively in the user's browser without requiring an external backend environment for code execution.

## 5. Current State and Testing Strategy

The repository is in a state of rapid functional expansion, integrating complex browser-based virtualization alongside LLM orchestration.
- The project has recognized the need for rigorous testing to match this complexity, as detailed in `TESTING_PROPOSAL.md`.
- Currently, High-level E2E tests are conducted using Playwright (runnable via `npm run test:e2e`).
- The proposed strategy emphasizes moving towards robust, isolated unit and integration testing. This includes:
  - Mocking HTTP responses for `isomorphic-git` operations in `GitFs.ts`.
  - Testing Sval sandbox execution environments securely using `jsdom` and web workers.
  - Leveraging `@testing-library/react` for UI components.
  - Ensuring the integrity of Terminal payloads and v86 WASM VM lifecycles.
