# Knowledge-Joern: Specification

> Sub-document of [code-graph.md](code-graph.md)

---

## S1. Module Manifest

```json
{
  "id": "knowledge-joern",
  "name": "Code Graph",
  "version": "1.0.0",
  "type": "knowledge",
  "description": "Analyzes code structure and predicts change impact zones. Requires a pre-computed .joern/ index (produced by GitHub Action). Falls back to empty results when no index is available.",
  "tools": [
    {
      "name": "knowledge-joern.traceImpact",
      "description": "Given file paths, returns all transitively affected files. Walks the file dependency graph.",
      "parameters": {
        "type": "object",
        "properties": {
          "files": {
            "type": "array",
            "items": { "type": "string" },
            "description": "Seed file paths to trace from"
          },
          "depth": {
            "type": "number",
            "description": "Max traversal depth. Default: 5. Use 1 for direct dependents only."
          }
        },
        "required": ["files"]
      }
    },
    {
      "name": "knowledge-joern.computeOverlap",
      "description": "Given two sets of file paths, computes their impact overlap. Returns shared files.",
      "parameters": {
        "type": "object",
        "properties": {
          "setA": {
            "type": "array",
            "items": { "type": "string" },
            "description": "First set of file paths"
          },
          "setB": {
            "type": "array",
            "items": { "type": "string" },
            "description": "Second set of file paths"
          }
        },
        "required": ["setA", "setB"]
      }
    },
    {
      "name": "knowledge-joern.suggestTaskSplit",
      "description": "Given work items with estimated file lists, suggests which can be separate tasks and which must be combined. Returns overlap analysis.",
      "parameters": {
        "type": "object",
        "properties": {
          "items": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": { "type": "string" },
                "title": { "type": "string" },
                "estimatedFiles": {
                  "type": "array",
                  "items": { "type": "string" }
                }
              },
              "required": ["id", "title", "estimatedFiles"]
            },
            "description": "Work item candidates for task splitting"
          }
        },
        "required": ["items"]
      }
    },
    {
      "name": "knowledge-joern.getFileDependencies",
      "description": "Returns the direct import/dependency graph for a given file.",
      "parameters": {
        "type": "object",
        "properties": {
          "file": {
            "type": "string",
            "description": "File path to query"
          }
        },
        "required": ["file"]
      }
    },
    {
      "name": "knowledge-joern.getClusters",
      "description": "Returns auto-detected module boundaries in the codebase.",
      "parameters": {
        "type": "object",
        "properties": {}
      }
    },
    {
      "name": "knowledge-joern.getIndexStatus",
      "description": "Returns metadata about the current code graph index or null if none exists.",
      "parameters": {
        "type": "object",
        "properties": {}
      }
    }
  ],
  "capabilities": [
    {
      "action": "impact-analysis",
      "description": "Can predict which files are affected by a change and how far the blast radius extends. Use before planning to understand the scope of work.",
      "tools": ["CodeGraph.traceImpact", "CodeGraph.computeOverlap", "CodeGraph.getFileDependencies"],
      "suggestedWhen": "task involves multiple files or areas of the codebase"
    },
    {
      "action": "task-splitting",
      "description": "Can determine if multiple work items can run as separate tasks without merge conflicts by analyzing file-level impact overlap. Separate tasks get their own executor sessions and branches.",
      "tools": ["CodeGraph.suggestTaskSplit"],
      "suggestedWhen": "user request spans multiple unrelated areas or distinct features"
    },
    {
      "action": "structure-overview",
      "description": "Can provide a high-level view of code organization — which files form tightly-coupled groups, which are high-impact hubs.",
      "tools": ["CodeGraph.getClusters", "CodeGraph.getFileDependencies"],
      "suggestedWhen": "planning changes to unfamiliar parts of the codebase"
    }
  ],
  "sandboxBindings": {
    "CodeGraph.traceImpact": "knowledge-joern.traceImpact",
    "CodeGraph.computeOverlap": "knowledge-joern.computeOverlap",
    "CodeGraph.suggestTaskSplit": "knowledge-joern.suggestTaskSplit",
    "CodeGraph.getFileDependencies": "knowledge-joern.getFileDependencies",
    "CodeGraph.getClusters": "knowledge-joern.getClusters",
    "CodeGraph.getIndexStatus": "knowledge-joern.getIndexStatus"
  },
  "permissions": []
}
```

---

## S2. Architect Configuration

### S2.1 ArchitectConfig type

```typescript
interface ArchitectConfig {
  generatedAt: string;                // ISO 8601
  generatedConstitution: string;      // auto-generated from module capabilities
  userNotes: string;                  // user edits, survives regeneration
  activeModules: string[];            // module IDs used to generate
}
```

### S2.2 Generation and regeneration

- On first startup: architect reads all module capabilities, generates constitution via one LLM call
- On subsequent startups: checks if `activeModules` matches current modules. If yes, reuse existing. If no, regenerate generated part only.
- User notes are never overwritten by regeneration.

### S2.3 What the architect sees at runtime

```
[GENERATED CONSTITUTION]
I am the Fleet architect. Available capabilities:
1. impact-analysis (knowledge-joern) — I can check which files a change affects
2. task-splitting (knowledge-joern) — I can check if work items overlap
3. structure-overview (knowledge-joern) — I can see code organization
4. code-generation (executor-jules) — I can delegate implementation
5. source-reading (knowledge-repo-browser) — I can read repo files

MY WORKFLOW:
1. Read the user request
2. If unclear or ambiguous, stop and ask for clarification
3. For multi-area requests, call suggestTaskSplit to check for overlap
4. Use traceImpact to understand blast radius before planning steps
5. Use readFile if I need to understand existing implementation
...

[USER NOTES]
- For this repo, always keep CSS changes in the same task as template changes
- Don't split tasks smaller than 2 steps
```

---

## S3. Type Changes

### S3.1 No changes to existing types

`TaskStep` and `Task` interfaces remain unchanged. Task splitting happens at the architect level.

### S3.2 Module manifest extension

The `capabilities` field is added to `ModuleManifest`:

```typescript
export interface ModuleCapability {
  action: string;              // e.g. "impact-analysis", "task-splitting"
  description: string;         // what this enables, in architect-friendly language
  tools: string[];             // sandbox binding names that support this action
  suggestedWhen: string;       // hint for when the architect should consider using this
}

export interface ModuleManifest {
  // ... existing fields ...
  capabilities?: ModuleCapability[];  // NEW — declares what this module enables
}
```

### S3.3 New types for the module

File: `src/modules/knowledge-joern/types.ts`

```typescript
export interface RepoIndex {
  metadata: IndexMetadata | null;
  fileDeps: FileDependencyGraph;
  usages: UsageIndex;
  clusters: ClusterIndex;
}

export interface IndexMetadata {
  timestamp: string;
  commit: string;
  joernVersion: string;
  fileCount: number;
  schemaVersion: number;
}

export interface FileDependencyGraph {
  imports: Record<string, string[]>;
  importedBy: Record<string, string[]>;
}

export interface UsageIndex {
  [symbol: string]: {
    files: string[];
    methods: string[];
  };
}

export interface ClusterIndex {
  [clusterName: string]: string[];
}

export interface WorkItem {
  id: string;
  title: string;
  estimatedFiles: string[];
}

export interface TaskSplitResult {
  independent: WorkItem[];
  merged: MergedGroup[];
  conflicts: ConflictInfo[];
}

export interface MergedGroup {
  ids: string[];
  reason: string;
}

export interface ConflictInfo {
  a: string;
  b: string;
  sharedFiles: string[];
}
```

---

## S4. Sandbox Bindings Contract

All six bindings follow the same pattern: read pre-computed JSON, compute answer, return structured data. No network calls at query time.

| Binding | Input | Output | Complexity |
|---|---|---|---|
| `CodeGraph.traceImpact(files, depth?)` | `string[]`, `number` | `{ affectedFiles: string[], depth: number }` | O(V+E) graph traversal |
| `CodeGraph.computeOverlap(setA, setB)` | `string[]`, `string[]` | `{ sharedFiles: string[], safe: boolean }` | Two traversals + intersection |
| `CodeGraph.suggestTaskSplit(items)` | `WorkItem[]` | `TaskSplitResult` | O(n²) overlap matrix + connected components |
| `CodeGraph.getFileDependencies(file)` | `string` | `{ imports: string[], importedBy: string[] }` | O(1) lookup |
| `CodeGraph.getClusters()` | — | `{ clusters: Record<string, string[]> }` | O(1) lookup |
| `CodeGraph.getIndexStatus()` | — | `IndexMetadata | null` | O(1) lookup |

Tools are shared: architect calls them during generation via tool-use, programmer calls them during execution via sandbox bindings. Same handlers, same routing.

---

## S5. Data Files Specification

### S5.1 `.joern/metadata.json`

```json
{
  "timestamp": "2026-04-06T14:30:00Z",
  "commit": "a1b2c3d4e5f6",
  "joernVersion": "4.0.0",
  "fileCount": 47,
  "schemaVersion": 1
}
```

### S5.2 `.joern/file-deps.json`

```json
{
  "imports": {
    "src/core/orchestrator.ts": [
      "src/core/prompt.ts",
      "src/core/sandbox.ts",
      "src/core/registry.ts",
      "src/core/event-bus.ts",
      "src/services/db.ts",
      "src/types.ts"
    ]
  },
  "importedBy": {
    "src/core/prompt.ts": ["src/core/orchestrator.ts"],
    "src/core/sandbox.ts": ["src/core/orchestrator.ts"]
  }
}
```

### S5.3 `.joern/usages.json`

```json
{
  "ModuleManifest": {
    "files": ["src/core/types.ts", "src/core/registry.ts", "src/core/prompt.ts"],
    "methods": ["ModuleRegistry.getAll", "composeProgrammerPrompt"]
  }
}
```

### S5.4 `.joern/clusters.json`

```json
{
  "core": ["src/core/orchestrator.ts", "src/core/prompt.ts", "src/core/sandbox.ts"],
  "services": ["src/services/db.ts", "src/services/GlobalVars.ts"],
  "negotiators": ["src/services/negotiators/JulesNegotiator.ts"]
}
```

### S5.5 `.joern/dataflow.json`

Direct output from `joern-slice data-flow`. Joern-native JSON. Unused in v1, kept for future.

---

## S6. Error Handling

| Condition | Behavior |
|---|---|
| `.joern/` doesn't exist | `getIndexStatus()` returns `null`. All queries return empty. Architect constitution notes "no impact data." Graceful degradation. |
| `.joern/` malformed JSON | Queries return empty. `eventBus.emit('module:log', ...)` with corruption warning. |
| Index is stale | `getIndexStatus()` returns metadata with commit. Architect can note staleness. |
| File not found in index | `getFileDependencies` returns `{ imports: [], importedBy: [] }`. No error. |
| Network error loading index | Falls back to cached data. If no cache, returns empty. |

---

## S7. Permissions

`"permissions": []` — reads static JSON via existing `RepositoryTool`. No network, no writes, no timers.

---

## S8. Integration Points

| Module | Interaction |
|---|---|
| `ModuleManifest` (types.ts) | Gains `capabilities` field |
| `ArchitectConfig` (new) | Stores generated constitution + user notes |
| `knowledge-repo-browser` | This module uses `RepositoryTool.readFile` to load `.joern/*.json` |
| Orchestrator | `moduleRequest` gains routing for 6 new tools. No other changes. |
