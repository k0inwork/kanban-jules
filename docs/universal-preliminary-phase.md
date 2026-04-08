# Universal Preliminary Phase for All Architects

## Executive Summary

**Proposal**: Extend all architect modules with an optional **preparation stage** that determines task readiness before a **preliminary phase** (react loop) runs.

**Three-Stage Architecture**:

1. **Preparation Stage**: Task Readiness Assessment
   - Stage 1: Task Classification (What type is this?)
   - Stage 2: Readiness Criteria Discovery (What do we check?)
   - Stage 3: Readiness Measurement (Are we ready?)
2. **Preliminary Phase** (React Loop): Targeted Context Gathering
   - Runs only if Preparation Stage determines task is *not ready*
   - Multi-turn conversation (first prompt + N follow-ups)
   - Targets specific criteria identified in Preparation Stage
3. **Protocol Generation**: Optimized Protocol
   - Single LLM call incorporating all context
   - Skips unnecessary preliminary work for ready tasks

| Aspect | Current | Proposed | Impact |
|---------|----------|--------------|--------|
| **Task Readiness** | None (implicitly ready) | Formal assessment via domains | ✅ Structured decision making |
| **Criteria Discovery** | Abstract requirements (quality, context) | Domain-specific translation (Specs, Code, DB, GUI) | ✅ Concrete, interconnected |
| **Preliminary Phase** | Per-architect (implicit) | Universal (all architects) | ✅ Unified approach |
| **LLM Calls** | 1 (direct protocol) | 1 (assessment) + 1 (protocol) OR N (prelim) + 1 (protocol) | ⚠️ Adds N (controlled by readiness) | ✅ Opt-out for simple tasks |
| **React Loop** | None | First prompt + N follow-ups (if not ready) | ⚠️ Controlled via targets |
| **Tool Integration** | Manual tool invocation | Manifest-driven capability registry | ✅ Dynamic, extensible |
| **Implementation** | Per-architect enhancements | Module manifest field + tool targets | ✅ Single pattern |

---

## 1. Domain-Driven Readiness Framework

### 1.1 Core Concept: Domains of Interest

**Problem**: User tasks are described in natural language ("Add OAuth login"). The system needs to understand *which areas* of the codebase this touches and what those areas require.

**Solution**: Define specific **domains of interest** that cover all areas of system development:
- **Specs** (Specifications) - Requirements, design, API contracts.
- **Code** (Business Logic) - Implementation, algorithms, backend services.
- **DB** (Data Layer) - Schemas, queries, migrations, state.
- **GUI** (User Interface) - Components, layouts, user flows, interactions.

**Key Insight**: These domains are **interconnected**. A change in one domain affects and is affected by others (e.g., GUI depends on Code APIs, Code depends on DB Schemas).

### 1.2 Domain Ontology

**Definition**: A **domain** is a bounded area of concern or system layer. It has:
- **Specific Terminology**: Language unique to that layer (e.g., `component`, `schema`, `endpoint`).
- **Artifacts**: Files, docs, structures unique to that layer.
- **Responsibilities**: What that layer owns and manages.
- **Dependencies**: What other layers it relies on.

#### The Four Domains

| Domain | Full Name | Focus Area | Terminology Examples | Artifact Examples | Existing Implementation |
|---------|-------------|-------------|---------------------|-------------------|--------------------------|
| **Specs** | Specifications | Requirements, design docs, API contracts | `PRD.md`, `api-contract.json`, `design.fig` | - |
| **Code** | Business Logic | Implementation, algorithms, services, controllers | `AuthController.ts`, `UserService.js` | `knowledge-joern` (Code Graph) |
| **DB** | Data Layer | Schemas, queries, migrations, state | `UserSchema.ts`, `001_migration.sql` | - |
| **GUI** | User Interface | Components, layouts, flows, interactions | `LoginForm.tsx`, `Dashboard.vue` | - |

### 1.3 Domain Interconnectedness

#### Dependency Graph

```
User Task (Natural Language)
   ↓
[Specs] (Understands intent)
   ↓
   ├─→ [Code] (Implements logic)
   │     ├─→ [DB] (Persists data)
   │     │     └─→ [Specs] (Constraints fed back)
   │     │
   │     └─→ [GUI] (Calls API)
   │           └─→ [Specs] (UI requirements fed back)
   │
   └─→ [GUI] (Designs UI) ← Can skip Code for simple UI
```

#### Bidirectional Influence

| Direction | Example | Impact |
|-----------|----------|--------|
| **Specs → Code** | Spec: "User must login with OAuth" | Code implements OAuth logic |
| **Code → DB** | Code: "Store user tokens" | DB creates token table |
| **DB → Specs** | DB: "Requires unique email" | Spec updates: "Email must be unique" |
| **GUI → Specs** | GUI: "Login form needs 2FA toggle" | Spec updates: "Add 2FA requirement" |
| **Specs → GUI** | Spec: "Login form on left, register on right" | GUI implements layout |
| **GUI → Code** | GUI: "Login needs email search" | Code implements `/search` endpoint |
| **DB → Code** | DB: "New user table structure" | Code adapts queries to match schema |
| **Code → GUI** | Code: "New API response format" | GUI updates to handle new data |
| **GUI → DB** | GUI: "Filter users by role" | DB adds index for role column |

#### Ripple Effect

**Concept**: A change in one domain causes cascading requirements in others.

**Example**: "Add 2FA (Two-Factor Authentication)"

| Domain | Change | Cascading Impact |
|---------|---------|-----------------|
| **Specs** | "Require 2FA for logins" | Code: Add 2FA logic<br>DB: Add secret code table<br>GUI: Add input field + toggle |
| **Code** | "Implement TOTP validation" | DB: Add secret column<br>GUI: Update form (wait for code) |
| **DB** | "Add `secret_code` column to users" | Code: Update queries<br>Specs: Document new field |
| **GUI** | "Add code input + resend button" | Code: Add `/verify` endpoint<br>Specs: Update flow docs |

---

## 2. User-to-Domain Mapping: Translating Natural Language

### 2.1 Concept: Translation Layer

**Problem**: User says: *"Add OAuth login"* (Natural Language)

**System Needs**: Domain-specific terms:
- **Specs**: "Define login flow, specify requirements"
- **Code**: "Implement OAuth callback, handle tokens"
- **DB**: "Add user tokens table"
- **GUI**: "Create login form, add provider button"

**Solution**: **Translation Layer** - Maps user terms to domain actions.

### 2.2 User Term → Domain Mapping

| User Term | Domain | Mapped Action | Why |
|-----------|---------|---------------|------|
| "Add feature X" | Code | Code modification |
| "Migrate" | DB | Data/System movement |
| "Spec", "design", "plan" | Specs | Design/planning phase |
| "Login", "page", "view" | GUI | User interaction |
| "API", "service", "logic" | Code | Backend logic |
| "Store data", "save" | DB | Data persistence |
| "Show data", "list", "table" | GUI | User data visualization |
| "Delete" | Code + DB | Code logic + Data removal |
| "Deploy", "env", "infrastructure" | Specs | Infra requirements |

### 2.3 Task Type → Readiness Profile Mapping

Each task type has a **readiness signature** - which domains matter most?

| Task Type | Critical Domains | Secondary Domains | Skip Domains |
|-----------|-----------------|------------------|--------------|
| **Implementation** | Specs, Code, DB, GUI | Risk, Quality | - |
| **Refactoring** | Code, DB | Specs, Dependencies | Risk, Architecture |
| **Debugging** | Code, DB, Specs | - | GUI, Architecture |
| **Review** | Code, GUI, Specs, Architecture | Quality, Dependencies | DB |
| **Testing** | Code, DB, Specs | GUI, Quality | - |
| **Planning** | DB, Specs, Architecture | - | Code, GUI |
| **Documentation** | Specs, GUI, Code | Architecture | - | DB, Quality |
| **Migration** | DB, Code, Specs, Architecture | Risk, Quality | GUI |
| **Delegation** | Specs, Code, GUI | - | DB, Risk, Architecture |
| **Optimization** | Code, DB, Specs, GUI | - | Architecture, Dependencies |
| **Infrastructure** | DB, Specs, Architecture, GUI | - | Code, Dependencies |
| **Security** | Code, Specs, GUI, Architecture | - | DB, Quality |

---

## 3. Domain-Specific Readiness: What Does "Ready" Mean?

### 3.1 General Readiness

**Question**: For THIS specific domain (e.g., "Make Migration"), are we ready?

**Answer**: Measure satisfaction of domain-specific criteria.

#### Specs Readiness

| Criterion | How to Measure | "Ready" Means |
|-----------|------------------|---------------|
| **Requirements Complete** | All requirements listed? | Yes: No open questions |
| **Constraints Defined** | Security, performance, cost constraints known? | Yes: No blockers |
| **Design Artifacts Exist** | Wireframes, diagrams, contracts available? | Yes: Have inputs for other domains |

#### Code Readiness

| Criterion | How to Measure | "Ready" Means |
|-----------|------------------|---------------|
| **Dependencies Known** | Deps known (via knowledge-joern) | Yes: Have dependency graph |
| **Impact Understood** | Affected files known (via knowledge-joern) | Yes: Know blast radius |
| **Structure Understood** | Modules/clusters known (via knowledge-joern) | Yes: Know code organization |
| **Complexity Known** | Complexity score known (via knowledge-joern) | Yes: Know effort level |

#### DB Readiness

| Criterion | How to Measure | "Ready" Means |
|-----------|------------------|---------------|
| **Schema Understood** | Tables, columns, relationships clear? | Yes: Can write SQL/migrations |
| **Migration Path Known** | How to get from A to B? | Yes: Can write migration script |
| **Performance Constraints** | Indexes, query limits known? | Yes: Can optimize queries |
| **Rollback Plan** | Can we undo if migration fails? | Yes: Have backup/restore strategy |

#### GUI Readiness

| Criterion | How to Measure | "Ready" Means |
|-----------|------------------|---------------|
| **Components Identified** | Which screens/components needed? | Yes: Can list components |
| **User Flows Defined** | User journey (step A → B → C) known? | Yes: Can wire components |
| **API Dependencies Clear** | Which endpoints to call? | Yes: Can add `fetch()` calls |
| **Layout/Style Known** | Design system, CSS classes? | Yes: Can style components |

---

## 4. Implementation Architecture

### 4.1 Manifest-Driven Capability Discovery

**Critical Principle**: Tool capability discovery should be **manifest-driven, not LLM-driven**.

All modules in system have manifests that define their domain-specific capabilities. Read these at startup.

#### Manifest Capability Schema

Each knowledge module MUST declare its analysis capabilities in manifest:

```typescript
interface AnalysisCapability {
  // Identification
  criterionId: string;           // e.g., "code-dependencies-known", "gui-components-identified"
  name: string;                 // Display name
  domain: DomainId;              // 'specs', 'code', 'db', 'gui'
  description: string;          // What this capability measures/assesses

  // Applicability
  applicableTaskTypes: TaskType[];
  priority: number;
}
```

#### Manifest Example (Code Domain)

```json
{
  "id": "knowledge-joern",
  "name": "Code Graph",
  "type": "knowledge",
  "description": "Analyzes code structure and predicts change impact zones.",
  "analysisCapabilities": [
    {
      "criterionId": "code-dependencies-known",
      "name": "Dependency Analysis",
      "domain": "code",
      "description": "Analyzes import dependencies and returns dependency graph.",
      "applicableTaskTypes": ["implementation", "refactoring", "planning"]
    },
    {
      "criterionId": "code-impact-known",
      "name": "Impact Analysis",
      "domain": "code",
      "description": "Predicts which files are affected by a change and how far blast radius extends.",
      "applicableTaskTypes": ["implementation", "migration", "optimization"]
    },
    {
      "criterionId": "code-structure-known",
      "name": "Structure Overview",
      "domain": "code",
      "description": "Provides high-level view of code organization — which files form tightly-coupled groups.",
      "applicableTaskTypes": ["refactoring", "review", "planning"]
    }
  ]
}
```

### 4.2 Capability Registry Architecture

**Startup Loading**:

```
1. Discover all modules
2. Load each manifest.json
3. Parse "analysisCapabilities" arrays
4. Register each capability:
   capabilityRegistry.register(capability)
5. Index by:
   - Domain (code, db, gui, specs)
   - Task Type (implementation, debugging, etc.)
   - Module ID (which tool provides this)
6. Ready for runtime queries
```

**Runtime Query**:

```
Query: "Get capabilities for domain 'code'"
Registry Logic:
  1. Filter by applicableTaskTypes: ['implementation', 'coding']
  2. Filter by domain: 'code'
  3. Group by priority
  4. Return: [
       { criterionId: "deps-known", name: "Dependency Analysis", ... },
       { criterionId: "impact-known", name: "Impact Analysis", ... },
       ...
     ]
```

---

## 5. Preparation Stage: The Three-Step Flow

### 5.1 Visual Flow

```
Task Created
   ↓
┌─────────────────────────────────┐
│ Stage 1: Classification   │
│ "Who are we?"            │
│ → Task Type               │
│ → Complexity Level          │
└──────────┬──────────────────┘
           ↓
┌─────────────────────────────────┐
│ Stage 2: Discovery        │
│ "What do we check?"       │
│ → Select Strategy         │
│ → Execute Discovery      │
│ → Available Domains     │
└──────────┬──────────────────┘
           ↓
┌─────────────────────────────────┐
│ Stage 3: Measurement     │
│ "Are we ready?"           │
│ → Measure Each Domain   │
│ → Calculate Confidence   │
│ → Aggregate Readiness    │
└──────────┬──────────────────┘
           ↓
    Ready? → Skip Prelim, Generate Protocol
Not Ready? → Run Prelim (with specific domains)
```

### 5.2 Stage 1: Task Classification (Who Are We?)

**Question**: What type of task is this?

**Answer**: Map task to one of N task types.

### 5.3 Stage 2: Readiness Criteria Discovery (What Do We Check?)

**Question**: For THIS task type at THIS complexity level, which domains matter?

**Answer**: Filter universal domains down to what's relevant for this specific situation.

**Example**:

```
Task: "Add OAuth login"
Type: Implementation
Complexity: Medium

Universal Domains (all available):
- Specs: Clarification, completeness
- Code: Dependencies, impact, structure
- DB: Schema, migrations
- GUI: Components, layouts

Relevant Domains Filter (for this task):
- KEEP: Specs (is task clear?)
- KEEP: Code (can we build it?)
- KEEP: GUI (where does auth fit?)
- SKIP: DB (no previous artifacts needed)

Discovery Result: 3 domains to check
```

### 5.4 Stage 3: Readiness Measurement (Are We Ready?)

**Question**: For each relevant domain, are we satisfied?

**Answer**: Measure satisfaction level (not satisfied → satisfied).

**Example Measurement**:

```
Domain: Code
Criterion: "Dependencies Known"
Measurement: "Do we have dependency graph?"
- Tool: knowledge-joern (Code Graph)
- Result: SATISFIED (graph loaded)
- Action: Skip this target

Domain: DB
Criterion: "Schema Understood"
Measurement: "Do we know DB schema?"
- Tool: None available
- Result: UNKNOWN
- Action: Skip this target (cannot gather)
```

---

## 6. Preliminary Phase: Targeted Context Gathering

### 6.1 Concept: React Loop Only If Not Ready

**Key Insight**: Skip preliminary phase entirely if preparation stage returns **SUFFICIENT** readiness.

**Flow**:

```
Preparation Stage Result: All Domains Ready
  ↓
  Skip Preliminary Phase
  ↓
  Generate Protocol (Single LLM call)
  ↓
  Execute Protocol

Preparation Stage Result: One Domain Missing (e.g., GUI)
  ↓
  Run Preliminary Phase (React Loop) for GUI domain
  ↓
  Generate Protocol (Single LLM call with context)
  ↓
  Execute Protocol
```

---

## 7. Orchestrator Integration

### 7.1 No Breaking Changes

```typescript
// orchestrator.ts - No changes needed

protocol = await this.moduleRequest(
  task.id,
  'architect-{type}.generateProtocol',  // SAME INTERFACE
  [task.title, task.description]           // SAME INPUTS
);
// But architect internally does:
// 1. Preparation Stage (Classification -> Discovery -> Measurement)
// 2. If NOT READY: Preliminary Phase (React Loop)
// 3. Protocol Generation (Single LLM call with all domain context)
```

---

## 8. Benefits Summary

### ✅ Unified Pattern

| Benefit | Description |
|----------|-------------|
| **All architects enhanced** | Same pattern applies to all 5 types |
| **No new modules** | Extends existing modules via manifest |
| **Opt-in** | Targets optional, no breaking changes |
| **Dynamic tools** | Auto-detects available analysis tools |
| **Type-specific** | Each architect defines relevant domains |
| **Zero LLM cost for discovery** | Manifest-driven, instant lookup |

### ✅ Concrete Domains

| Benefit | Description |
|----------|-------------|
| **Concrete areas** | "Make Migration" vs. "Context" |
| **Granular readiness** | Assess Code separately from GUI or Specs |
| **Clear actions** | "Gather source schema" vs. "Gather context" |
| **Interconnectedness awareness** | System understands that GUI depends on Code which depends on DB |
| **Existing Code Domain** | Supported by `knowledge-joern` module (Code Graph) |

---

## 9. Implementation Roadmap

### Phase 1: Core Infrastructure (4 days)

**Deliverables**:
1. Domain Ontology interfaces (`DomainId`, `DomainReadiness`, etc.)
2. Task Type taxonomy + profile mappings
3. Capability registry system with manifest-driven loading
4. Three-stage preparation flow (Classification -> Discovery -> Measurement)
5. Readiness aggregation logic (Critical vs. Secondary)

### Phase 2: Architect-Specific Enhancements (2-3 days)

**Deliverables**:
1. Update all 5 architect manifests to support domain discovery
2. Implement architect-specific readiness profiles
3. Add `preliminaryConfig` fields (enabled, maxPrompts, etc.)

### Phase 3: Tool Integration (2 days)

**Deliverables**:
1. Enhance existing knowledge modules with domain-specific capabilities (e.g., `knowledge-joern` for Code domain)
2. Update `RequestContext` with domain registry methods
3. Document tool authoring guidelines for analysis tools
4. Add auto-proposal of available targets

### Phase 4: Testing & Rollout (2 days)

**Deliverables**:
1. Unit tests for domain translation
2. Integration tests for preparation stage
3. End-to-end tests for full flow
4. Documentation updates

---

## 10. Conclusion

The **Domain-Driven Readiness Framework** provides:

- ✅ **Four Core Domains**: Specs, Code, DB, GUI - bounded areas of concern.
- ✅ **Interconnectedness Model**: Dependencies and influences between domains.
- ✅ **User-to-Domain Translation**: Maps user tasks to domain-specific actions.
- ✅ **Per-Domain Readiness**: Assess readiness for each domain independently.
- ✅ **Dependency Propagation**: Cascading changes across domains.
- ✅ **Manifest-Driven Discovery**: Zero LLM cost for capability detection.
- ✅ **Targeted Preliminary Phase**: Only runs for missing/blocked domains.
- ✅ **Partial Execution**: Work on ready domains while preparing blocked ones.
- ✅ **Existing Code Domain**: Supported by `knowledge-joern` module (Code Graph).

**Total Estimated Effort**: 10-11 days for full implementation (4 days core + 2-3 days architects + 2 days tools + 2 days testing).

**Verdict**: This domain-driven framework is recommended as the foundation for universal preliminary phase, providing a structured, concrete ontology for assessing task readiness across all architect types.
