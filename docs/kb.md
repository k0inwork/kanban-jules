# Project Brain: Knowledge Base

## 1. Overview
This document defines the architecture for our autonomous, context-aware agent system. The agent is empowered to leverage project history ("Project Brain") to make autonomous decisions, only interrupting the user when context is insufficient.

## 2. The Project Brain (Knowledge Infrastructure)
The Project Brain is a searchable, vector-indexed repository of all project intelligence.

### 2.1 Knowledge Store
*   **Produced Artifacts:** Design specs, research, code analysis, final outputs.
*   **Dropped Artifacts (Manual Knowledge):** Externally provided knowledge, project ideas, or manual documentation added by the user. These provide the foundational context for the agent.

### 2.2 Semantic Search (RAG)
*   **Automatic Indexing:** All artifacts are embedded and indexed.
*   **Tool:** Use `<ragSearch query="..."/>` to perform semantic similarity searches across all artifacts.

## 3. Confidence & Decision Protocol
The agent is forbidden from guessing. It must evaluate context before acting.

### 3.1 Execution Loop (`LocalAgent`)
1.  **Assess:** Do I have high confidence?
2.  **High Confidence:** Execute immediately. Log to chat.
3.  **Low Confidence:**
    *   Call `<ragSearch query="..."/>`.
    *   *Answer Found:* Log findings, update confidence to "High," execute.
    *   *Answer Not Found:* Log failure, call `<askUser question="..."/>`.

### 3.2 Planning Loop (`TaskArchitect`)
1.  **Assess:** Is the project state clear?
2.  **High Confidence:** Generate plan.
3.  **Low Confidence:**
    *   Call `<ragSearch query="..."/>`.
    *   *Context Found:* Incorporate and generate plan.
    *   *Context Missing:* Call `<askUser question="..."/>`.

## 4. Communication Rules
*   **Transparency:** All tool calls, Jules interactions, and agent reasoning must be logged to the `task.chat` database field.
*   **Mailbox Hygiene:** Only send messages to the mailbox for critical events requiring user input.
*   **Confidence:** Always assess confidence before acting.
