# Fleet Project Status Report - April 4, 2026

## Overview
The application has transitioned from an Autonomous Workspace into a **Distributed Agentic System**. The architecture has been completely decoupled, moving from a monolithic agent loop to a **Main Architect + Specialized Negotiators** model. This shift ensures high reliability, deterministic state management, and the ability to handle complex, long-running autonomous tasks without context pollution.

## Key Features Implemented

### 1. ReAct (Reasoning + Acting) Protocol
*   **Autonomous Reasoning**: The Main Agent now operates on a formal ReAct loop, maintaining a conversation history for the duration of a single "step" (milestone).
*   **Context Reset Policy**: To prevent context window bloat and "hallucination drift," the chat context is automatically cleared after every full ReAct cycle. The next step begins with only the **TaskPlan**, **Global Variable Registry**, and the **StepResult** of the previous action.
*   **Reflective Scripting**: The Agent no longer just "suggests" actions; it emits executable JavaScript code that is run within a secure `sval` sandbox by the Runtime.

### 2. The Negotiator Pattern (Sub-Agent Orchestration)
To shield the Main Agent from the entropy of external interactions, we have introduced specialized **Negotiator Agents**:
*   **JNA (Jules Negotiator Agent)**: An aggressive, persistent agent that manages the stateful interaction with Jules (System). It handles retries, progress updates, and technical negotiations autonomously.
*   **UNA (User Negotiator Agent)**: A patient, empathetic agent that manages human interaction. It handles clarifications and discussions without polluting the Main Agent's technical context.
*   **CNA (Crawler Negotiator Agent)**: A relentless information explorer that recursively interrogates the **Project Brain** (Knowledge Base) to synthesize complex answers from unstructured data.

### 3. Semantic Contracts & The Connector
*   **The Connector**: A new architectural layer that acts as a "Semantic Bridge." It uses lightweight LLM calls to verify if a Negotiator's freeform output satisfies the Main Agent's **Semantic Contract** (Success Criteria & Artifacts).
*   **Success Criteria & Artifacts**: Every request to a Negotiator now includes a freeform description of what success looks like, ensuring the sub-agent knows exactly when its mission is complete.

### 4. Global Variable Registry (World State)
*   **Persistent State Store**: Introduced a centralized, free-form `GlobalVars` registry. This is the **only** source of truth for persistent data across ReAct cycles, ensuring the system can resume perfectly after a crash or context reset.
*   **Atomic Updates**: The Registry is updated atomically after every successful code execution or tool call.

## Technical Architecture
*   **Runtime**: A deterministic executor that manages the ReAct loop, tool execution, and context resets.
*   **Sandbox**: `sval`-based JavaScript execution environment for reflective scripting.
*   **Negotiators**: Independent ReAct loops for JNA, UNA, and CNA, each with its own **Interaction Profile**.
*   **Knowledge Base**: Vector-indexed "Project Brain" containing architecture, task history, and codebase analysis.

---
*Fleet: The Self-Organizing Distributed Agentic Workspace*
