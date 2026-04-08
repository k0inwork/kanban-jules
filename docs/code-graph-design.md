# Knowledge-Joern: Design

> Sub-document of [code-graph.md](code-graph.md)
> This file covers data flow, self-constitution model, task splitting, architect config, and CI pipeline.

---

## D1. Data Flow

### D1.1 Build-time (GitHub Action)

```
git push to main/develop
       │
       ▼
┌─────────────────────────────────────────┐
│  GitHub Action: joern-index             │
│                                         │
│  1. Checkout repo                       │
│  2. Install Joern (cached in Actions)   │
│  3. joern-parse src/ → cpg.bin          │
│  4. joern-slice usages → usages.json    │
│  5. joern-slice data-flow → dataflow.json│
│  6. Post-process CPG → file-deps.json   │
│  7. Cluster detection → clusters.json   │
│  8. Generate metadata.json              │
│  9. Delete cpg.bin (too large for git)  │
│  10. Commit .joern/ to branch           │
└─────────────────────────────────────────┘
       │
       ▼
  .joern/ committed to repo (5 JSON files, ~50-200KB total)
```

### D1.2 Runtime — startup

```
Fleet starts
       │
       ▼
All modules load → manifests registered
       │
       ▼
Orchestrator.init()
  ├── JoernAnalyzer.loadIndex() → reads .joern/*.json via RepositoryTool
  └── Other modules init as normal
       │
       ▼
ArchitectConfig.load()
  ├── currentModules = registry.getAll().map(m => m.id)
  ├── matches stored activeModules? → YES: use existing constitution
  │                                 → NO:  regenerate (see D2)
  └── Merge: generatedConstitution + userNotes → architect system prompt
```

### D1.3 Runtime — task generation

```
User submits request
       │
       ▼
Architect reads its constitution (generated + user notes)
       │
       ▼
Architect follows its own workflow:
  ├── Reads request, identifies work areas
  ├── Calls tools as needed (traceImpact, suggestTaskSplit, readFile...)
  ├── Decides: one task or multiple?
  └── Outputs TaskPlan
       │
       ▼
Orchestrator processes each task independently
  (no changes to existing task pipeline)
```

---

## D2. Self-Constitution Model

### D2.1 The problem it solves

The old model baked module data into prompt text. Every new module required prompt changes. The architect had no agency over its own workflow.

The new model: the architect reads module **capabilities** and generates its own workflow. Capabilities are hints ("you *can* do this"), not commands ("you *must* do this"). The architect decides.

### D2.2 Constitution generation

On startup (or module change), the system calls the LLM once to generate the constitution:

```typescript
async function generateConstitution(modules: ModuleManifest[]): Promise<string> {
  const capabilities = modules
    .filter(m => m.capabilities && m.capabilities.length > 0)
    .map(m => m.capabilities!.map(c => ({
      module: m.id,
      action: c.action,
      description: c.description,
      tools: c.tools,
      suggestedWhen: c.suggestedWhen,
    })))
    .flat();

  const prompt = `
You are a Fleet task architect. Based on the available capabilities below,
write your own workflow constitution — a concise set of rules for how you
will approach task generation.

AVAILABLE CAPABILITIES:
${capabilities.map(c => `
- ${c.action} (from ${c.module}): ${c.description}
  Tools: ${c.tools.join(', ')}
  Consider using when: ${c.suggestedWhen}
`).join('\n')}

Write a constitution that covers:
1. What you do when you receive a request
2. Which tools you call and when
3. How you decide to split or combine work
4. What you skip for simple requests

Keep it under 40 lines. Be specific about tool names.
  `;

  return await llm.call(prompt);
}
```

### D2.3 Example generated constitution

```
I am the Fleet architect. My workflow:

1. Read the user request. If ambiguous, output a clarification question and stop.

2. For single-area requests (clear scope, one feature):
   - Skip impact analysis. Go straight to step planning.
   - Assign the appropriate executor.

3. For multi-area requests (multiple features, distinct concerns):
   - Call CodeGraph.getClusters to understand code structure.
   - Estimate which files each area touches.
   - Call CodeGraph.suggestTaskSplit with my estimates.
   - If independent: create separate tasks.
   - If overlapping: create one task with sequential steps, note the shared files.

4. Before planning steps for unfamiliar code:
   - Call CodeGraph.traceImpact on the target files.
   - If blast radius is large (10+ files), plan conservatively — fewer, smaller steps.

5. For every task output:
   - Each step has a title, description, and executor assignment.
   - Steps within a task are sequential.
   - Separate tasks are independent — different branches, different sessions.

6. When CodeGraph.getIndexStatus returns null (no index available):
   - Skip all CodeGraph tools. Plan as if no impact data exists.
   - Default to one task per request.
```

### D2.4 User notes layer

The user can add persistent notes that override or refine the generated constitution:

```
[GENERATED CONSTITUTION]
(see above)

[USER NOTES]
- For this repo, CSS and component changes are always coupled — never split them
- Always read the existing test file before planning any step that modifies source
- If the request mentions "refactor", always call traceImpact first regardless of scope
- Don't create more than 3 tasks from a single request without asking me
```

User notes are stored in `ArchitectConfig.userNotes`. They survive every constitution regeneration.

### D2.5 Regeneration trigger

```typescript
function needsRegeneration(config: ArchitectConfig | null, currentModules: ModuleManifest[]): boolean {
  if (!config) return true;
  const currentIds = currentModules.map(m => m.id).sort().join(',');
  const storedIds = [...config.activeModules].sort().join(',');
  return currentIds !== storedIds;
}
```

Only module additions/removals trigger regeneration. Joern index updates (new commits) do not — the index is data, not a capability.

---

## D3. Task Splitting

### D3.1 How the architect decides

The architect follows its own constitution. A typical flow for a multi-area request:

1. Architect identifies distinct work areas in the request
2. Estimates files for each area
3. Calls `CodeGraph.suggestTaskSplit(items)` to validate
4. Based on result, creates one or more tasks

### D3.2 Overlap detection algorithm

Connected components on the overlap graph:

```
1. Compute impact zone for each work item's estimatedFiles
2. Build overlap matrix:
   for i in 0..N:
     for j in i+1..N:
       overlap[i][j] = |impactZone[i] ∩ impactZone[j]| > 0
3. Find connected components via BFS
4. Each component with one node → independent task
   Each component with multiple nodes → must be one task
```

### D3.3 Example outputs

**Non-overlapping:**
```json
{
  "independent": [
    { "id": "1", "title": "Fix auth middleware", "estimatedFiles": ["auth.ts", "middleware.ts"] },
    { "id": "2", "title": "Fix CSS grid", "estimatedFiles": ["styles.css", "Header.tsx"] }
  ],
  "merged": [],
  "conflicts": []
}
```
Architect creates two Fleet tasks.

**Overlapping:**
```json
{
  "independent": [],
  "merged": [{ "ids": ["1", "2"], "reason": "shared impact on middleware.ts" }],
  "conflicts": [{ "a": "1", "b": "2", "sharedFiles": ["middleware.ts"] }]
}
```
Architect creates one Fleet task with sequential steps.

---

## D4. Architect Config Storage

### D4.1 Storage

`ArchitectConfig` is stored in Dexie (local DB, alongside existing `projectConfigs`):

```typescript
// In db.ts
this.version(17).stores({
  // ... existing tables ...
  architectConfigs: 'id'  // single record, id = "default"
});
```

### D4.2 Read/write

```typescript
// Load
const config = await db.architectConfigs.get('default');

// Check if regeneration needed
if (needsRegeneration(config, registry.getAll())) {
  const newConstitution = await generateConstitution(registry.getAll());
  const userNotes = config?.userNotes || '';
  await db.architectConfigs.put({
    id: 'default',
    generatedAt: new Date().toISOString(),
    generatedConstitution: newConstitution,
    userNotes: userNotes,
    activeModules: registry.getAll().map(m => m.id),
  });
}

// Get full prompt for architect
const config = await db.architectConfigs.get('default');
const architectPrompt = `${config.generatedConstitution}\n\n[USER NOTES]\n${config.userNotes}`;
```

### D4.3 User notes editing

User notes are editable through Fleet's UI (settings panel or a simple textarea). The generated constitution is displayed read-only. When the user saves notes:

```typescript
await db.architectConfigs.update('default', { userNotes: userInput });
```

---

## D5. CI Pipeline Design

### D5.1 GitHub Action workflow

File: `.github/workflows/joern-index.yml`

```yaml
name: Code Graph Index

on:
  push:
    branches: [main, develop]
    paths-ignore:
      - '.joern/**'
      - 'docs/**'
      - '*.md'
      - '.github/**'

jobs:
  index:
    runs-on: ubuntu-latest
    permissions:
      contents: write

    steps:
      - uses: actions/checkout@v4

      - name: Cache Joern installation
        id: cache-joern
        uses: actions/cache@v4
        with:
          path: /opt/joern
          key: joern-4.0.0

      - name: Install Joern
        if: steps.cache-joern.outputs.cache-hit != 'true'
        run: |
          wget -q https://github.com/joernio/joern/releases/latest/download/joern-install.sh
          chmod +x joern-install.sh
          ./joern-install.sh --install-dir=/opt/joern

      - name: Parse Code Property Graph
        run: |
          mkdir -p .joern
          /opt/joern/joern-parse src/ --output .joern/cpg.bin

      - name: Extract usage slices
        run: /opt/joern/joern-slice usages .joern/cpg.bin -o .joern/usages.json

      - name: Extract data flow slices
        run: /opt/joern/joern-slice data-flow .joern/cpg.bin -o .joern/dataflow.json --slice-depth 15

      - name: Post-process file dependencies and clusters
        run: node scripts/joern-postprocess.js .joern/

      - name: Generate metadata
        run: |
          cat > .joern/metadata.json << EOF
          {
            "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
            "commit": "$GITHUB_SHA",
            "joernVersion": "$(/opt/joern/joern --version 2>&1 | head -1)",
            "fileCount": $(find src -name '*.ts' -o -name '*.tsx' | wc -l),
            "schemaVersion": 1
          }
          EOF

      - name: Clean up binary
        run: rm -f .joern/cpg.bin

      - name: Commit results
        run: |
          git config user.name "joern-indexer[bot]"
          git config user.email "joern-indexer[bot]@users.noreply.github.com"
          git add .joern/
          git diff --cached --quiet || git commit -m "chore: update code graph index [skip ci]"
          git push
```

### D5.2 Post-processing script

File: `scripts/joern-postprocess.js`

~120 lines of Node.js. Parses source files for import statements, builds forward/reverse dependency maps, runs label propagation for cluster detection. No external dependencies.

### D5.3 Cost estimation

| Factor | Value |
|---|---|
| Action runtime per push | ~2-3 minutes |
| Joern install (cached) | ~30 seconds first run, 0 after |
| JSON artifact size | ~50-200KB total |
| GitHub Actions free tier | ~700 pushes/month |
| Constitution generation | 1 LLM call (~2K tokens) on startup only |

---

## D6. Design Critique

### D6.1 Overengineered

1. **`dataflow.json` is unused in v1.** Kept because it's free to produce. Not exposed as a tool initially.

2. **Cluster detection via label propagation.** Won't be perfect for all repos. Can be replaced without changing the interface.

### D6.2 Risks

1. **LLM-generated constitution can be wrong.** The architect might decide on a bad workflow. Mitigation: user notes can override. The generated constitution is editable-by-proxy.

2. **estimatedFiles are predictions.** The architect guesses files, calls suggestTaskSplit, but the guess can be wrong. Mitigation: failed tasks are retried or escalated to user. Low cost of being wrong.

3. **Joern JS/TS frontend limitations.** Dynamic imports and computed require paths may not resolve. Mitigation: supplement with static import analysis in post-processing script.

4. **Constitution regeneration costs one LLM call.** Only happens when modules change (rare). Acceptable.

### D6.3 What this model enables

The self-constitution model is the key design decision. It means:

- **New modules = automatic capability discovery.** No prompt changes. No hardcoded data flows.
- **User has final say.** Notes override the generated constitution.
- **One tool list, two consumers.** Architect uses tools via LLM function-calling. Programmer uses same tools via sandbox bindings. No duplication.
- **Extensible without regression.** Adding a `knowledge-tests` module later just means new capabilities. The architect regenerates its constitution and starts using test impact data. Zero changes to existing modules.
