# Architectural and Feature Analysis: System Evolution

This document provides a comprehensive architectural and feature analysis of the system, based on the evolution tracked across the `collective` and `codebase-analysis-collective` branches. It categorizes the architectural shifts and major feature introductions into three distinct time phases: from the system's origin to 7 days ago, from 7 to 4 days ago, and from 4 days ago to the present.

## Phase 1: Origin to 7 Days Ago (Foundation and Orchestration)

The earliest phase of the system established the core architecture for a distributed, multi-agent kanban and orchestration system. The architectural focus was on modularity, agent delegation, and establishing robust execution environments.

### Architectural Solutions
* **Agent Orchestration Pattern:** Introduced the Orchestrator and Negotiator pattern, establishing a clear hierarchy for task routing. The `TaskRouter` was later repurposed as `TaskArchitect` to support protocol-driven execution.
* **Module System:** Implemented a dynamic module system (`Module Management`, `HostConfig`, `Module Configurations`) to plug in agent capabilities and executors. This transitioned the system away from global variables toward a context-driven approach (`AgentContext`).
* **Execution Environments:** Integrated dual execution capabilities:
  * **WASM/v86 Terminal:** A significant architectural milestone was the integration of a WASM terminal with a v86 VM boot, providing an isolated, interactive sandbox environment.
  * **LLMFS (9p filesystem):** Introduced a 9p filesystem with real API calls and timestamped responses to support the LLM's interaction with the execution environment.
* **Smart Delegation & Protocols:** Shifted to protocol-driven execution where the TaskArchitect generates protocols and marks CLI-heavy stages for external agents (e.g., Jules) using the `finishStage` tool.

### Key Functional Capabilities
* **Task & Agent Management:** Enabled automatic task progression, parsing tasks from agent messages, and displaying current agents for tasks.
* **Communication & User Interaction:** Added mailbox, agent messaging functionality, and logs for JNA (Jules Negotiator Agent) and UNA (User Negotiator Agent) to improve transparency.
* **External Integrations:** Added Gemini API support, GitHub proxy support (SOCKS5), and isomorphic-git for repository interactions (branch creation, PR reporting).

---

## Phase 2: 7 to 4 Days Ago (Persistence, Replay, and Knowledge Integration)

This intermediate phase focused heavily on state persistence, system resilience, and bridging the execution environment with broader network and knowledge contexts.

### Architectural Solutions
* **Persistent Overlays & YuanFS:** Introduced `idbfs` (IndexedDB File System) as a persistent overlay, unifying the filesystem architecture under `YuanFS`. This solved the issue of ephemeral WASM state by ensuring data integrity and context persistence across sessions.
* **WISP Networking:** Added WISP networking relay for v86 VM TCP tunneling. This allowed the isolated WASM environment to communicate with the outside world, drastically expanding the capabilities of agents running inside the sandbox.
* **Event Sourcing & Replay:** Implemented tool call history recording and a "replay mode" for task recovery. This is a crucial architectural shift toward event-sourcing, allowing the system to reconstruct agent states and recover from failures.
* **Knowledge Base (KB) Infrastructure:** Began the architectural integration of a Module Knowledge Base, setting the stage for RAG (Retrieval-Augmented Generation) capabilities.

### Key Functional Capabilities
* **System Pipeline:** Added `repack.sh` pipeline for `sys.tar.gz` builds, improving the WASM boot process.
* **Configuration:** Refactored handler registration and added YAML support for configuration management.

---

## Phase 3: 4 Days Ago to Now (Advanced RAG, Conflict Resolution, and Projector Model)

The most recent phase represents a massive leap in system intelligence, focusing on Knowledge Management, automated decision logging, and resolving agent conflicts through a unified projection model.

### Architectural Solutions
* **The Projector Model (3-Part Context):** Unified the system's constitutions and knowledge through a "Projector" with a 3-part context model. This model dynamically projects relevant knowledge (Base, RAG, Dynamic Context) to the agents based on their current focus.
* **Event-Driven Decision Harvest:** Architected a dual-source decision capture system. It captures decisions from internal agents via event listeners and from external agents (like Jules) by parsing commit messages. This ensures all architectural and implementation decisions are fed back into the Knowledge Base.
* **Conflict Resolution Engine:** Implemented an evidence-based conflict classification and auto-resolution system (with audit trails). If agents generate conflicting decisions, the system detects this (Phase 1f), creates a "conflict-pending projection block," and forces a resolution.
* **Micro-Dream Verification:** Introduced a mechanism for "micro-dream verification" and tracing superseded decisions, ensuring the KB doesn't bloat with stale or incorrect agent hallucinations.

### Key Functional Capabilities
* **RAG & Search:** Introduced document RAG chunking, search, and CRUD operations with significant GUI improvements.
* **KB UI:** Added a Constitutions tab, an editable constitution view, and consolidated the KB into 5 distinct categories with a tabbed table view.
* **UI/UX:** Integrated an xterm.js chat panel for direct terminal interaction within the chat interface.

## Conclusion
The system has evolved from a basic task routing engine (Phase 1) into a resilient, persistent sandbox environment (Phase 2), and finally into a highly advanced, self-reflecting agentic system with RAG, event-driven decision harvesting, and automated conflict resolution (Phase 3).
