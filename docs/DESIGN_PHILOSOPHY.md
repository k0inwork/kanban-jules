# Fleet Orchestrator: Philosophy and Design

## Philosophy

The Fleet Orchestrator is designed as an **autonomous, agentic system** for complex software development tasks. Its core philosophy is built on the following principles:

1.  **Agentic Autonomy & Human-in-the-Loop:** The system is designed to be autonomous, but with explicit human oversight. It decomposes high-level user requests into actionable "protocols" and executes them autonomously, while providing mechanisms (like `UserNegotiator` and modals) to pause, review, and intervene.
2.  **Sandboxed Execution:** Security and reliability are paramount. All generated code is executed within a secure, isolated sandbox (`sval`) to prevent malicious or accidental system interference, with carefully injected APIs for system interaction.
3.  **Subagent Delegation:** The Orchestrator does not attempt to solve every problem alone. It delegates specialized tasks (e.g., complex coding, user input) to dedicated negotiators (JulesNegotiator, UserNegotiator), maintaining a clean separation of concerns.
4.  **Persistent State & Observability:** The system maintains a robust, persistent state using a local database (`Dexie`). Every action, code generation, and subagent interaction is logged and stored, providing full observability into the agent's decision-making process.
5.  **Task-Centric UI:** The UI is designed to mirror the agentic workflow, with a Kanban-board-based task management system that provides clear visibility into the status of each task (TODO, IN_PROGRESS, IN_REVIEW, DONE).

## Design & UX Choices

### UI/UX Patterns

*   **Kanban-Centric Workflow:** The primary interface is a Kanban board. This design choice provides immediate visual feedback on the state of all tasks, allowing the user to manage the agent's workload effectively.
*   **Modal-Based Interaction:** Modals are used for focused interactions (e.g., `NewTaskModal`, `TaskDetailsModal`, `SettingsModal`). This keeps the main workspace clean and minimizes context switching.
*   **Artifact-Driven Development:** The `ArtifactBrowser` and `PreviewPane` are central to the UX. The agent generates artifacts (code, files), and the user can browse, preview, and interact with them in real-time, reinforcing the "show, don't just tell" philosophy.
*   **Transparency through Logging:** The logs are not just for debugging; they are a first-class citizen in the UI, providing the user with a real-time, transparent view of the agent's internal thought process and execution steps.

### Core Architecture

*   **Agent Loop (`App.tsx`):** The central hub. It manages the agent loop, polls for tasks, and handles global state (tasks, settings, autonomy mode).
*   **Orchestrator (`Orchestrator.ts`):** The engine for task execution. It manages the lifecycle of a task, from protocol generation to sandbox execution and subagent delegation.
*   **Sandbox (`Sandbox.ts`):** Provides a secure environment for executing generated JavaScript code, with injected APIs for interacting with the system (e.g., `askJules`, `askUser`, `saveArtifact`).
*   **Negotiators (`JulesNegotiator.ts`, `UserNegotiator.ts`):** Specialized agents that handle external interactions. Jules handles complex delegation, while UserNegotiator facilitates human-in-the-loop interactions.
*   **State Management (`db.ts`, `JulesSessionManager.ts`):** Manages persistent data, including tasks, protocols, logs, and Jules sessions.

### Execution Flow

1.  **Protocol Generation:** Upon task initiation, the Architect generates a step-by-step protocol for the task.
2.  **Step Execution:** The Orchestrator picks up the first pending step, generates the necessary JavaScript code using an LLM, and executes it in the sandbox.
3.  **Subagent Interaction:** If a step requires external expertise, the Orchestrator calls `askJules` or `askUser` within the sandbox, which delegates the task to the respective negotiator.
4.  **State Update:** After each step, the Orchestrator updates the task's state, logs, and global variables in the database.
5.  **Completion/Review:** Once all steps are completed, the task is marked as `DONE` and moved to `IN_REVIEW`.
