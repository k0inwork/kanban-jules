# Fleet Orchestrator: Philosophy and Design

## Philosophy

The Fleet Orchestrator is designed as an **autonomous, agentic system** for complex software development tasks. Its core philosophy is built on the following principles:

1.  **Agentic Autonomy:** The system operates by decomposing high-level user requests into a series of actionable steps (a "protocol"). It then autonomously executes these steps, delegating complex tasks to specialized subagents (Jules, User) and managing its own state.
2.  **Sandboxed Execution:** Security and reliability are paramount. All generated code is executed within a secure, isolated sandbox (`sval`) to prevent malicious or accidental system interference.
3.  **Subagent Delegation:** The Orchestrator does not attempt to solve every problem alone. It delegates specialized tasks (e.g., complex coding, user input) to dedicated negotiators (JulesNegotiator, UserNegotiator), maintaining a clean separation of concerns.
4.  **Persistent State:** The system maintains a robust, persistent state using a local database (`Dexie`). This allows for task resumption, detailed logging, and state management across execution steps.
5.  **Transparency & Observability:** Every action, code generation, and subagent interaction is logged and stored, providing full observability into the agent's decision-making process.

## Design

### Core Architecture

*   **Agent Loop (`App.tsx`):** The main entry point and orchestrator of the agent loop. It polls for pending tasks, manages the overall agent state, and initiates task processing.
*   **Orchestrator (`Orchestrator.ts`):** The central engine for task execution. It manages the lifecycle of a task, from code generation to sandbox execution and subagent delegation.
*   **Sandbox (`Sandbox.ts`):** Provides a secure environment for executing generated JavaScript code, with injected APIs for interacting with the system (e.g., `askJules`, `askUser`, `saveArtifact`).
*   **Negotiators (`JulesNegotiator.ts`, `UserNegotiator.ts`):** Specialized agents that handle external interactions. Jules handles complex delegation, while UserNegotiator facilitates human-in-the-loop interactions.
*   **State Management (`db.ts`, `JulesSessionManager.ts`):** Manages persistent data, including tasks, protocols, logs, and Jules sessions.

### Execution Flow

1.  **Protocol Generation:** Upon task initiation, the Architect generates a step-by-step protocol for the task.
2.  **Step Execution:** The Orchestrator picks up the first pending step, generates the necessary JavaScript code using an LLM, and executes it in the sandbox.
3.  **Subagent Interaction:** If a step requires external expertise, the Orchestrator calls `askJules` or `askUser` within the sandbox, which delegates the task to the respective negotiator.
4.  **State Update:** After each step, the Orchestrator updates the task's state, logs, and global variables in the database.
5.  **Completion/Review:** Once all steps are completed, the task is marked as `DONE` and moved to `IN_REVIEW`.
