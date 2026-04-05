# Fleet Architecture Specification (agents.spec.md)

## 1. Executive Summary
The Fleet architecture transitions the application from a monolithic, conversational agent loop into a **Distributed Agentic System**. Instead of the Main Agent directly calling tools and accumulating massive context histories, it acts as a **Main Architect**. 

The Main Architect receives a clean slate for every protocol step, writes executable JavaScript to accomplish that step, and relies on an **Orchestrator** to run the code. The Orchestrator delegates complex, messy interactions to specialized **Negotiator Subagents** (JNA, UNA, CNA). The Main Architect only sees the final, clean output or detailed error reports, preventing context pollution and hallucination drift.

## 2. Core Components

### 2.1 The Main Architect (Code Generator)
*   **Role:** High-level reasoning and scripting.
*   **Input:** The current protocol step description, the `GlobalVars` state, and the output of the previous step.
*   **Output:** Executable JavaScript code.
*   **Context Policy:** **Flushed per step.** Every step is self-contained. The agent cannot rely on conversational history from previous steps, only on the persistent `GlobalVars` registry.

### 2.2 The Orchestrator & Sandbox
*   **Role:** Executes the Main Architect's JS code in a secure, isolated environment.
*   **Capabilities:** Injects data processing utilities and async Subagent APIs into the sandbox.
*   **Error Handling:** Catches execution errors, Subagent failures, or Semantic Contract violations. It feeds these errors back to the Main Architect, prompting it to rewrite the code, handle the error, fail the task, or ask the user for help.

### 2.3 The Negotiators (Subagents)
These are invoked by the Orchestrator via the JS code. They use the same underlying LLM but have specific system prompts and retry logic.
*   **JNA (Jules Negotiator Agent):** Handles repository work, CLI commands, and file modifications via the Jules system.
*   **UNA (User Negotiator Agent):** Handles human interaction, asking for clarifications or permissions.
*   *(Deferred to separate project)* **CNA (Crawler Negotiator Agent):** Interrogates the "Project Brain" to synthesize answers.

### 2.4 Global Variable Registry (`GlobalVars`)
*   **Role:** The single source of truth for persistent state across protocol steps.
*   **Mechanism:** A key-value store accessible within the JS sandbox (e.g., `GlobalVars.set('analysis', data)`).

---

## 3. Execution Flow (The ReAct-Code Loop)

1.  **Step Initialization:** Orchestrator picks up the next `pending` protocol step.
2.  **Prompt Generation:** Orchestrator prompts the Main Architect: *"Write JS code to execute Step X. Available tools: askJules(prompt, successCriteria), askUser(question), queryBrain(query). Current GlobalVars: {...}"*
3.  **Code Generation:** Main Architect outputs a JS script.
4.  **Execution:** Orchestrator runs the script in the Sandbox.
    *   *If script calls `askJules`:* Orchestrator pauses, spins up JNA. JNA interacts with Jules until `successCriteria` is met (verified by LLM). JNA returns the final result to the script.
5.  **Completion:** Script finishes. Orchestrator saves the returned data to the Step Result, updates `GlobalVars`, and marks the step as `completed`.
6.  **Error Loop:** If the script throws an error (syntax, runtime, or Subagent failure):
    *   Orchestrator prepends the error stack/details to the Main Architect's context.
    *   Prompts: *"Execution failed. Rewrite the code, handle the error, mark task as DONE (failed), or call askUser() for help."*

---

## 4. Envisioned Codebase Changes

To implement this vision, the following major changes are required:

1.  **`src/services/LocalAgent.ts` Rewrite:**
    *   Remove the standard conversational ReAct loop.
    *   Implement the prompt-to-code generation logic.
    *   Implement the context-flushing mechanism per step.
2.  **Sandbox Implementation:**
    *   Integrate a JS execution engine (see Alternatives below).
    *   Create the bridge between the Sandbox and the React frontend/IndexedDB.
3.  **Subagent Services Creation:**
    *   `src/services/negotiators/JulesNegotiator.ts`
    *   `src/services/negotiators/UserNegotiator.ts`
    *   `src/services/negotiators/CrawlerNegotiator.ts`
    *   Implement the "Semantic Contract" verification loop within these negotiators.
4.  **Project Brain Integration:** *(Deferred to a separate project)*
    *   Update `ArtifactTree` and `TaskFs` to support the new "local store of artifacts" folder concept.
    *   Implement the filtering logic (exclude `_` files) for the CNA.

---

## 5. Finalized Design Decisions

Based on the architectural review, the following decisions have been made:

### 5.1 The JS Sandbox Environment
*   **Primary Choice:** `sval` (JavaScript Interpreter in JS). It provides strict control and easy integration.
*   **Fallback/Consideration:** If `sval` proves to block the main UI thread during heavy execution or struggles with complex async/await bridging, we will pivot to **Web Workers**. Web Workers offer native isolation and non-blocking execution, though message passing adds slight complexity.

### 5.2 Semantic Contract Verification
*   **Decision:** LLM Verification (Loose checking). 
*   **Rationale:** We will not enforce strict JSON schema validation yet. The Orchestrator will use a fast LLM call to evaluate if the Subagent's output meets the `successCriteria`. This provides the necessary flexibility for free-form tasks while maintaining the "Semantic Bridge."

### 5.3 Error Loop Limits
*   **Decision:** Trust the LLM with a Hard Limit as a Last Resort.
*   **Rationale:** We will rely on the Main Architect's prompt to instruct it to call `askUser()` if it gets stuck. However, to prevent runaway API costs and infinite loops, a hard limit (e.g., 5 or 10 retries) will be enforced as a final failsafe to automatically pause the task.

---

## 6. Implementation Phases

To ensure a smooth transition to the Fleet architecture, the implementation will be split into the following phases:

### Phase 1: Core Sandbox & State Management
*   Integrate `sval` into the project.
*   Build the `Sandbox` service capable of executing JS code and returning results.
*   Implement the `GlobalVars` registry (key-value store) and inject it into the Sandbox environment.
*   *Checkpoint:* Verify that simple JS scripts can read/write to `GlobalVars` within the Sandbox.

### Phase 2: The Orchestrator & ReAct-Code Loop
*   Rewrite `src/services/LocalAgent.ts` to act as the Main Architect.
*   Implement the prompt generation that instructs the LLM to write JS code based on the current protocol step.
*   Build the Orchestrator loop: Prompt -> Generate Code -> Execute in Sandbox -> Handle Errors/Success.
*   Implement the context-flushing mechanism (ensuring the LLM only sees the current step and `GlobalVars`).

### Phase 3: Subagent Negotiators (JNA, UNA)
*   Create the base `Negotiator` interface.
*   Implement `UserNegotiator` (UNA) to bridge `askUser()` calls to the UI.
*   Implement `JulesNegotiator` (JNA) to handle repository interactions and CLI commands.
*   Inject these async APIs into the Sandbox environment.

### Phase 4: Semantic Verification & Error Handling
*   Implement the LLM-based Semantic Contract verification for Subagent outputs.
*   Implement the error feedback loop: catching Sandbox/Subagent errors and feeding the stack trace back to the Main Architect.
*   Implement the "Hard Limit" failsafe for the error loop.

### Phase 5: UI Integration
*   Update the UI to reflect the new Orchestrator state (showing code generation, execution, and Subagent activity).
