# Collective Branch Achievements: Context Transfer and Knowledge Base Architecture

The `collective` branch (and associated documentation updates in `docs/codebase-analysis-collective`) introduces significant architectural enhancements to Fleet (kanban-jules). Specifically, it advances the project from a simple React-based orchestrator into a sophisticated Distributed Agentic System capable of robust state management and contextual memory.

This document synthesizes the key achievements realized in this branch, focusing heavily on **Context Transfer** and the **Knowledge Base Architecture**.

---

## 1. Context Transfer Enhancements

A primary challenge in multi-agent or multi-step execution is maintaining state safely across sandbox executions, UI unmounts, and system crashes. The branch completely overhauled how context flows between the components.

### 1.1 Immediate Persistence of AgentContext

Previously, the `AgentContext` (a singleton key-value map shared across steps) was only written to Dexie (IndexedDB) at the very end of a task execution. If a crash or refresh occurred mid-task, intermediate state (like routing decisions or error history) was lost.

**Achievement:**
The `AgentContext` writes are now **immediately persisted to Dexie on every write**. When the sandbox code executes `addToContext(key, value)`, the orchestrator synchronously reflects this in IndexedDB. This ensures that the context map survives browser crashes and reloads, creating a highly resilient execution state.

### 1.2 Virtual Filesystem IPC and `boardVM` Bridge

The `collective` branch implements an intricate cross-boundary communication layer. Fleet relies on an in-browser Linux WASM VM (Wanix) executing Go binaries (like the Yuan supervisor agent).

**Achievement:**
Context is now safely bridged between the JavaScript/React host ("Fleet") and the WASM agent ("Yuan") through:
1. **Virtual Filesystems:** IPC between the WASM agent and Fleet occurs via synthetic filesystems (`LLMFS`, `ToolFS`) instead of network protocols.
2. **The `boardVM` Interface:** A global bridge (`window.boardVM`) provides the clean API surface that connects the WASM VM to Fleet's internal module registry. This allows the supervisor agent in the WASM environment to read board state, create tasks, and dispatch tools via `dispatchTool()`.

### 1.3 Event-Driven State Machine Context

**Achievement:**
Tasks have been refactored to use a centralized `TaskStateMachine`. Instead of unstructured status strings, transitions (e.g., `TODO` → `IN_PROGRESS` → `ERROR`) are strictly validated and automatically persist to the database. An event bus emits `task:state_changed` on every valid transition. Furthermore, module logs are now collected globally under `moduleLogs[moduleId]`, providing a persistent context trail for why a step failed or succeeded.

---

## 2. The Knowledge Base (KB) and Projection Architecture

The most sophisticated achievement documented in this branch is the multi-layered, budget-capped Knowledge Base projection system, often referred to as the "Knowledge Projector". It shifts the agent from isolated execution to a continuous learning loop.

### 2.1 The Three-Layer Prompt Composition

When an agent prompt is generated, it no longer relies on static context. Instead, a "Projector" (injector) synthesizes context dynamically into three distinct layers:

1. **BASE (Static):** The system Constitution and project-level configs. It defines the rules of the road and is always injected.
2. **RAG (Task Relevance):** Retrieves concrete documents (`kbDocs` like specifications or design references) based on semantic overlap with the task tags. It asks: *"What documentation do we have for this type of task?"*
3. **EXPERIENCE (Accumulated History):** Retrieves error logs and observations from previous runs (`kbLog`), matched by executor tags and domain. It asks: *"What happened the last time we tried this?"*

### 2.2 Budget-Capped Escalation Layers (L0-L3)

The system introduces formal hierarchy layers, each with strict character budgets for injecting context. This prevents the LLM context window from being overwhelmed while ensuring agents get the level of detail they need:

* **L3 (Programmer/Executor):** Receives very concrete, tight knowledge. It sees specific errors that happened before (`EXPERIENCE` capped at ~2400 chars, abstraction level ≤ 5) and strict specs (`RAG` capped at ~1200 chars). It is the primary *producer* of knowledge by catching errors and logging them via `KB_record()`.
* **L2 (Architect):** Receives broader patterns and design documents. Budget is heavily weighted towards RAG (~2400 chars) for design planning, and it sees patterns rather than just raw stack traces.
* **L1 (Overseer):** Sees the tactical board state and higher-level tactical documents.
* **L0 (Yuan Supervisor):** Sees the widest strategic view, with the largest budget for both `kbDocs` and `kbLog`.

### 2.3 The Continuous Learning Flywheel

**Achievement:**
A true ReAct loop with memory has been established.
1. The **L3 Programmer** attempts a task in the sandbox.
2. If it fails, it uses `KB_record(error)` to write to the `kbLog` (tagging the executor and task).
3. On the next execution of a similar task, the **Projector** fetches this log entry and injects it as `EXPERIENCE`.
4. The LLM sees the previous failure and writes better code to avoid it.

This turns errors from frustrating dead-ends into valuable system memory. Over time, the `EXPERIENCE` layer gets richer, and the agents natively self-correct based on past empirical failures.

---

## Summary

The `collective` branch essentially transforms Fleet from a simple stateless task runner into a **resilient, memory-aware autonomous system**.

By guaranteeing that `AgentContext` is immediately persisted to Dexie and establishing a strict `TaskStateMachine`, **Context Transfer** is robust across browser sessions and sandbox boundaries. Simultaneously, the **Knowledge Base Architecture** enables a multi-agent hierarchy (L0-L3) to automatically learn from past mistakes using a budget-capped, tag-based RAG and Experience injection system.