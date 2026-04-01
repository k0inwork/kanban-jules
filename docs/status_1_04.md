# Fleet Project Status Report - April 1, 2026

## Overview
The application has evolved from a simple task tracker into an **Autonomous Workspace**. The system now supports persistent task management, cross-task artifact sharing, and an intelligent "Project Manager" agent that coordinates work through a centralized Mailbox.

## Key Features Implemented

### 1. Autonomous Orchestration & Control
*   **Autonomy Modes**: Introduced a three-tier autonomy system (Manual, Assisted, Full) to give users granular control over the agent's behavior.
    *   **Manual**: User must manually accept and start all tasks.
    *   **Assisted (Co-Pilot)**: Adds "Accept & Start" buttons to the Mailbox for one-click execution.
    *   **Full (Auto-Pilot)**: Agent automatically accepts and starts task proposals based on the Project Constitution.
*   **Project Constitution**: A new editable "Constitution" (Shift + Click on Bot icon) allows users to define project-specific rules and map **Project Stages** to expected **Artifacts**.
    *   Templates for different project types (Research, MVP, Develop, etc.) are included.
    *   The `ProcessAgent` now reads and adheres to this Constitution when analyzing the project.
*   **Mailbox Enhancements**: Added "Decline" buttons to proposals and "Accept & Start" for Assisted mode. Proposals are automatically removed once acted upon.

### 2. Unified Workspace & Previews
*   **Constitution Editor**: A dedicated editor for the Project Constitution, integrated into the tabbed view.
*   **Tabbed Interface**: Files from the repository and artifacts from tasks now open in a centralized tabbed view, allowing for side-by-side comparison and deep inspection.
*   **Persistent Kanban**: The board is now backed by IndexedDB (`Dexie`), ensuring that task state, logs, and metadata persist across sessions.
*   **Cross-Task Artifact Sharing**: Agents can now discover and read artifacts created by other tasks in the same repository/branch, enabling a "Blackboard" style of collaboration.

### 3. Agent Tooling Upgrades
*   **`listTasks`**: Agents can now query the Kanban board to understand project context.
*   **`sendMessage`**: Agents can proactively communicate with the user via the Mailbox.
*   **`listArtifacts`**: Upgraded to support repository-wide discovery.
*   **Constitution-Aware Analysis**: The `ProcessAgent` now uses the Project Constitution to identify current stages and missing artifacts.

### 4. UI/UX Refinements
*   **Autonomy Dropdown**: A new header dropdown for switching between Manual, Assisted, and Full autonomy modes.
*   **Smart Sidebar Toggles**: The header now features intelligent toggles for Files and Mailbox, with unread message indicators.
*   **Contextual Navigation**: Selecting a file or artifact automatically switches the workspace to "Tabbed Mode," while closing all tabs returns the user to the "Board Mode."
*   **Stale Template Protection**: The Constitution Editor now detects and updates stale default templates to ensure the latest stage-artifact mapping structure is used.

## Technical Architecture
*   **Database**: Dexie.js with tables for `tasks`, `taskArtifacts`, `messages`, `julesSessions`, and `projectConfigs`.
*   **Agent Logic**: `LocalAgent` (worker) and `ProcessAgent` (orchestrator) using Gemini/OpenAI models.
*   **State Management**: React hooks synced with IndexedDB live queries.
*   **Autonomy Logic**: A state-driven loop in `App.tsx` that coordinates task execution based on the selected `AutonomyMode`.

---
*Fleet: The Self-Organizing Workspace*
