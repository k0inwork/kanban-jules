# Knowledge-Joern: Code

> Sub-document of [code-graph.md](code-graph.md)
> Full implementation: JoernAnalyzer, constitution generator, architect config, GitHub Action, tests.

---

## C1. File Structure

```
src/
  types.ts                                    ← MODIFY: add capabilities to ModuleManifest
  core/
    orchestrator.ts                           ← MODIFY: add joern routing, constitution init
    registry.ts                               ← MODIFY: add joern manifest
    architect-config.ts                       ← NEW: constitution generation, storage, loading
  modules/
    knowledge-joern/
      manifest.json                           ← NEW
      types.ts                                ← NEW
      JoernAnalyzer.ts                        ← NEW
      JoernAnalyzer.test.ts                   ← NEW
    architect-config.test.ts                  ← NEW
  services/
    db.ts                                     ← MODIFY: add architectConfigs table (v17)
.github/
  workflows/
    joern-index.yml                           ← NEW
scripts/
  joern-postprocess.js                        ← NEW
```

---

## C2. Manifest

File: `src/modules/knowledge-joern/manifest.json`

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
      "description": "Given file paths, returns all transitively affected files.",
      "parameters": { "type": "object", "properties": { "files": { "type": "array" }, "depth": { "type": "number" } } }
    },
    {
      "name": "knowledge-joern.computeOverlap",
      "description": "Checks overlap between two file sets' impact zones.",
      "parameters": { "type": "object", "properties": { "setA": { "type": "array" }, "setB": { "type": "array" } } }
    },
    {
      "name": "knowledge-joern.suggestTaskSplit",
      "description": "Suggests which work items can be separate tasks vs must be combined.",
      "parameters": { "type": "object", "properties": { "items": { "type": "array" } } }
    },
    {
      "name": "knowledge-joern.getFileDependencies",
      "description": "Returns import dependencies for a file.",
      "parameters": { "type": "object", "properties": { "file": { "type": "string" } } }
    },
    {
      "name": "knowledge-joern.getClusters",
      "description": "Returns auto-detected module boundaries.",
      "parameters": { "type": "object", "properties": {} }
    },
    {
      "name": "knowledge-joern.getIndexStatus",
      "description": "Returns index metadata or null.",
      "parameters": { "type": "object", "properties": {} }
    }
  ],
  "capabilities": [
    {
      "action": "impact-analysis",
      "description": "Can predict which files are affected by a change and how far the blast radius extends. Use before planning to understand scope.",
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

## C3. Types

### C3.1 Module manifest extension

File: `src/types.ts` — add to `ModuleManifest`

```typescript
export interface ModuleCapability {
  action: string;
  description: string;
  tools: string[];
  suggestedWhen: string;
}

export interface ModuleManifest {
  // ... existing fields ...
  capabilities?: ModuleCapability[];  // NEW — declares what this module enables for the architect
}
```

### C3.2 Module types

File: `src/modules/knowledge-joern/types.ts`

```typescript
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
  [symbol: string]: { files: string[]; methods: string[] };
}

export interface ClusterIndex {
  [clusterName: string]: string[];
}

export interface RepoIndex {
  metadata: IndexMetadata | null;
  fileDeps: FileDependencyGraph;
  usages: UsageIndex;
  clusters: ClusterIndex;
}

export interface ImpactResult {
  seedFiles: string[];
  affectedFiles: string[];
  depth: number;
}

export interface OverlapResult {
  setAImpact: string[];
  setBImpact: string[];
  sharedFiles: string[];
  safe: boolean;
}

export interface WorkItem {
  id: string;
  title: string;
  estimatedFiles: string[];
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

export interface TaskSplitResult {
  independent: WorkItem[];
  merged: MergedGroup[];
  conflicts: ConflictInfo[];
}
```

### C3.3 Architect config type

File: `src/core/architect-config.ts`

```typescript
export interface ArchitectConfig {
  id: string;                        // always "default"
  generatedAt: string;
  generatedConstitution: string;
  userNotes: string;
  activeModules: string[];
}
```

---

## C4. JoernAnalyzer

File: `src/modules/knowledge-joern/JoernAnalyzer.ts`

```typescript
import { RepositoryTool } from '../knowledge-repo-browser/RepositoryTool';
import {
  RepoIndex, IndexMetadata, ClusterIndex,
  ImpactResult, OverlapResult, WorkItem, TaskSplitResult,
  MergedGroup, ConflictInfo
} from './types';

export class JoernAnalyzer {
  private index: RepoIndex;
  private loaded: boolean = false;

  constructor() {
    this.index = {
      metadata: null,
      fileDeps: { imports: {}, importedBy: {} },
      usages: {},
      clusters: {}
    };
  }

  async loadIndex(repoUrl: string, branch: string, token: string): Promise<void> {
    try {
      const [metadataRaw, fileDepsRaw, usagesRaw, clustersRaw] = await Promise.all([
        RepositoryTool.readFile(repoUrl, branch, token, '.joern/metadata.json').catch(() => null),
        RepositoryTool.readFile(repoUrl, branch, token, '.joern/file-deps.json').catch(() => null),
        RepositoryTool.readFile(repoUrl, branch, token, '.joern/usages.json').catch(() => null),
        RepositoryTool.readFile(repoUrl, branch, token, '.joern/clusters.json').catch(() => null),
      ]);

      this.index = {
        metadata: metadataRaw ? JSON.parse(metadataRaw) : null,
        fileDeps: fileDepsRaw ? JSON.parse(fileDepsRaw) : { imports: {}, importedBy: {} },
        usages: usagesRaw ? JSON.parse(usagesRaw) : {},
        clusters: clustersRaw ? JSON.parse(clustersRaw) : {},
      };

      if (Object.keys(this.index.fileDeps.importedBy).length === 0 && Object.keys(this.index.fileDeps.imports).length > 0) {
        this.index.fileDeps.importedBy = this.buildReverseMap(this.index.fileDeps.imports);
      }

      this.loaded = true;
      console.log(`[JoernAnalyzer] Index loaded. Commit: ${this.index.metadata?.commit || 'none'}`);
    } catch (error) {
      console.warn('[JoernAnalyzer] Failed to load index:', error);
      this.loaded = false;
    }
  }

  getStatus(): IndexMetadata | null { return this.index.metadata; }
  isLoaded(): boolean { return this.loaded; }

  traceImpact(files: string[], depth: number = 5): ImpactResult {
    if (!this.loaded) return { seedFiles: files, affectedFiles: [], depth };

    const affected = new Set<string>();
    const queue: { file: string; d: number }[] = files.map(f => ({ file: f, d: 0 }));

    while (queue.length > 0) {
      const { file, d } = queue.shift()!;
      if (affected.has(file) || d > depth) continue;
      affected.add(file);
      for (const dep of this.index.fileDeps.importedBy[file] || []) {
        if (!affected.has(dep)) queue.push({ file: dep, d: d + 1 });
      }
    }

    return { seedFiles: files, affectedFiles: Array.from(affected), depth };
  }

  computeOverlap(setA: string[], setB: string[]): OverlapResult {
    const impactA = this.traceImpact(setA);
    const impactB = this.traceImpact(setB);
    const setBAll = new Set(impactB.affectedFiles);
    const shared = impactA.affectedFiles.filter(f => setBAll.has(f));
    return { setAImpact: impactA.affectedFiles, setBImpact: impactB.affectedFiles, sharedFiles: shared, safe: shared.length === 0 };
  }

  suggestTaskSplit(items: WorkItem[]): TaskSplitResult {
    if (!this.loaded || items.length === 0) return { independent: [], merged: [], conflicts: [] };
    if (items.length === 1) return { independent: items, merged: [], conflicts: [] };

    // Compute impact zones
    const impacts = new Map<string, Set<string>>();
    for (const item of items) {
      impacts.set(item.id, new Set(this.traceImpact(item.estimatedFiles).affectedFiles));
    }

    // Build overlap graph
    const conflicts: ConflictInfo[] = [];
    const adj = new Map<string, Set<string>>();
    for (const item of items) adj.set(item.id, new Set());

    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        const shared = [...impacts.get(a.id)!].filter(f => impacts.get(b.id)!.has(f));
        if (shared.length > 0) {
          adj.get(a.id)!.add(b.id);
          adj.get(b.id)!.add(a.id);
          conflicts.push({ a: a.id, b: b.id, sharedFiles: shared });
        }
      }
    }

    // Connected components
    const visited = new Set<string>();
    const components: string[][] = [];
    for (const item of items) {
      if (visited.has(item.id)) continue;
      visited.add(item.id);
      const component = [item.id];
      const q = [item.id];
      while (q.length > 0) {
        const current = q.shift()!;
        for (const neighbor of adj.get(current)!) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            component.push(neighbor);
            q.push(neighbor);
          }
        }
      }
      components.push(component);
    }

    // Build result
    const itemMap = new Map(items.map(i => [i.id, i]));
    const independent: WorkItem[] = [];
    const merged: MergedGroup[] = [];

    for (const component of components) {
      if (component.length === 1) {
        independent.push(itemMap.get(component[0])!);
      } else {
        const sharedFiles = [...new Set(conflicts.filter(c => component.includes(c.a) || component.includes(c.b)).flatMap(c => c.sharedFiles))].slice(0, 5);
        merged.push({ ids: component, reason: `shared impact on ${sharedFiles.join(', ')}` });
      }
    }

    return { independent, merged, conflicts };
  }

  getFileDependencies(file: string): { imports: string[]; importedBy: string[] } {
    return { imports: this.index.fileDeps.imports[file] || [], importedBy: this.index.fileDeps.importedBy[file] || [] };
  }

  getClusters(): ClusterIndex { return this.index.clusters; }

  private buildReverseMap(forward: Record<string, string[]>): Record<string, string[]> {
    const reverse: Record<string, string[]> = {};
    for (const [file, deps] of Object.entries(forward)) {
      for (const dep of deps) {
        if (!reverse[dep]) reverse[dep] = [];
        reverse[dep].push(file);
      }
    }
    return reverse;
  }
}
```

---

## C5. Architect Config

File: `src/core/architect-config.ts`

```typescript
import { db } from '../services/db';
import { ModuleManifest, ModuleCapability } from '../types';

export interface ArchitectConfig {
  id: string;
  generatedAt: string;
  generatedConstitution: string;
  userNotes: string;
  activeModules: string[];
}

function needsRegeneration(config: ArchitectConfig | undefined, currentModules: ModuleManifest[]): boolean {
  if (!config) return true;
  const currentIds = currentModules.map(m => m.id).sort().join(',');
  const storedIds = [...config.activeModules].sort().join(',');
  return currentIds !== storedIds;
}

function collectCapabilities(modules: ModuleManifest[]): { module: string; action: string; description: string; tools: string[]; suggestedWhen: string }[] {
  return modules
    .filter(m => m.capabilities && m.capabilities.length > 0)
    .flatMap(m => m.capabilities!.map(c => ({
      module: m.id,
      action: c.action,
      description: c.description,
      tools: c.tools,
      suggestedWhen: c.suggestedWhen,
    })));
}

function buildConstitutionPrompt(capabilities: ReturnType<typeof collectCapabilities>): string {
  return `You are a Fleet task architect. Based on the available capabilities below,
write your own workflow constitution — a concise set of rules for how you
will approach task generation.

AVAILABLE CAPABILITIES:
${capabilities.map(c => `
- ${c.action} (from ${c.module}): ${c.description}
  Tools: ${c.tools.join(', ')}
  Consider using when: ${c.suggestedWhen}
`).join('\n')}

AVAILABLE TOOLS (full list from all modules):
Use these tools during task generation via function-calling.
When you need data, call the tool directly — do not guess.

Write a constitution that covers:
1. What you do when you receive a request
2. Which tools you call and when
3. How you decide to split or combine work into tasks
4. What you skip for simple requests

Keep it under 40 lines. Be specific about tool names.
Output only the constitution text, no markdown, no preamble.`;
}

export async function loadOrGenerateConstitution(
  modules: ModuleManifest[],
  llmCall: (prompt: string) => Promise<string>
): Promise<ArchitectConfig> {
  const existing = await db.architectConfigs?.get('default');

  if (!needsRegeneration(existing, modules) && existing) {
    return existing;
  }

  const capabilities = collectCapabilities(modules);
  const userNotes = existing?.userNotes || '';

  let generatedConstitution: string;
  if (capabilities.length === 0) {
    generatedConstitution = `I am the Fleet architect. No special capabilities available.
My workflow: read the request, plan steps, assign executor.`;
  } else {
    const prompt = buildConstitutionPrompt(capabilities);
    generatedConstitution = await llmCall(prompt);
  }

  const config: ArchitectConfig = {
    id: 'default',
    generatedAt: new Date().toISOString(),
    generatedConstitution,
    userNotes,
    activeModules: modules.map(m => m.id),
  };

  await db.architectConfigs?.put(config);
  return config;
}

export function getArchitectPrompt(config: ArchitectConfig): string {
  return `${config.generatedConstitution}\n\n[USER NOTES]\n${config.userNotes || '(none)'}`;
}

export async function updateUserNotes(notes: string): Promise<void> {
  await db.architectConfigs?.update('default', { userNotes: notes });
}
```

---

## C6. Orchestrator Changes

File: `src/core/orchestrator.ts` — modifications

### C6.1 Add imports and init

```typescript
import { JoernAnalyzer } from '../modules/knowledge-joern/JoernAnalyzer';
import { loadOrGenerateConstitution, getArchitectPrompt } from './architect-config';

export class Orchestrator {
  private joernAnalyzer: JoernAnalyzer | null = null;
  private architectConfig: ArchitectConfig | null = null;

  async init(config: OrchestratorConfig) {
    // ... existing init ...

    // Init JoernAnalyzer if module registered
    if (registry.get('knowledge-joern')) {
      this.joernAnalyzer = new JoernAnalyzer();
      await this.joernAnalyzer.loadIndex(config.repoUrl, config.repoBranch, config.julesApiKey);
    }

    // Load or generate architect constitution
    this.architectConfig = await loadOrGenerateConstitution(
      registry.getAll(),
      (prompt) => this.llm.call(prompt)  // reuse existing LLM client
    );
  }
```

### C6.2 Add moduleRequest routing

```typescript
// ADD inside moduleRequest(), before the final throw:
    if (toolName.startsWith('knowledge-joern.')) {
      if (!this.joernAnalyzer) throw new Error("JoernAnalyzer not initialized");
      switch (toolName) {
        case 'knowledge-joern.traceImpact':
          return this.joernAnalyzer.traceImpact(args[0], args[1]);
        case 'knowledge-joern.computeOverlap':
          return this.joernAnalyzer.computeOverlap(args[0], args[1]);
        case 'knowledge-joern.suggestTaskSplit':
          return this.joernAnalyzer.suggestTaskSplit(args[0]);
        case 'knowledge-joern.getFileDependencies':
          return this.joernAnalyzer.getFileDependencies(args[0]);
        case 'knowledge-joern.getClusters':
          return this.joernAnalyzer.getClusters();
        case 'knowledge-joern.getIndexStatus':
          return this.joernAnalyzer.getStatus();
      }
    }
```

### C6.3 Use constitution in task generation

Where the architect prompt is composed:

```typescript
// BEFORE:
const prompt = composeArchitectPrompt(registry.getAll()) + ...;

// AFTER:
const prompt = getArchitectPrompt(this.architectConfig!) + `

AVAILABLE TOOLS:
${registry.getAll().flatMap(m => m.tools).map(t => `- ${t.name}: ${t.description}`).join('\n')}

EXECUTORS:
${registry.getAll().filter(m => m.type === 'executor').map(e => `- ${e.name}: ${e.description}`).join('\n')}

Task Title: ${task.title}
Task Description: ${task.description}`;
```

No other orchestrator changes. `processTask` and `runStep` remain unchanged.

---

## C7. DB Migration

File: `src/services/db.ts` — add version 17

```typescript
// ADD after version 16:
this.version(17).stores({
  // Existing tables (unchanged)
  gitCache: 'path',
  taskArtifacts: '++id, taskId, repoName, branchName',
  taskArtifactLinks: '++id, taskId, artifactId',
  julesSessions: 'id, taskId, name, createdAt, repoUrl, branchName',
  messages: '++id, sender, taskId, type, status, category, activityName, timestamp',
  tasks: 'id, workflowStatus, agentState, createdAt',
  projectConfigs: 'id',
  // NEW
  architectConfigs: 'id'
});
```

---

## C8. Registry Update

File: `src/core/registry.ts`

```typescript
import joernManifest from '../modules/knowledge-joern/manifest.json';

// ADD to modules array:
joernManifest as ModuleManifest,
```

---

## C9. GitHub Action

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
          JOERN_VER=$(/opt/joern/joern --version 2>&1 | head -1 || echo "unknown")
          FILE_COUNT=$(find src -name '*.ts' -o -name '*.tsx' | wc -l | tr -d ' ')
          cat > .joern/metadata.json << METAEOF
          {"timestamp":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","commit":"$GITHUB_SHA","joernVersion":"$JOERN_VER","fileCount":$FILE_COUNT,"schemaVersion":1}
          METAEOF

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

---

## C10. Post-Processing Script

File: `scripts/joern-postprocess.js`

```javascript
#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const joernDir = process.argv[2];
if (!joernDir) { console.error('Usage: node joern-postprocess.js <joern-dir>'); process.exit(1); }

function buildFileDeps(srcDir) {
  const imports = {};
  const importedBy = {};

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(fullPath); continue; }
      if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;

      const content = fs.readFileSync(fullPath, 'utf-8');
      const fileDeps = [];
      const importRegex = /import\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/g;
      let match;
      while ((match = importRegex.exec(content)) !== null) {
        const importPath = match[1];
        if (importPath.startsWith('.')) {
          const resolved = path.normalize(path.join(path.dirname(fullPath), importPath));
          for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
            const candidate = resolved + ext;
            if (candidate.startsWith(srcDir) && fs.existsSync(candidate)) {
              fileDeps.push(candidate);
              break;
            }
          }
        }
      }

      if (fileDeps.length > 0) {
        imports[fullPath] = fileDeps;
        for (const dep of fileDeps) {
          if (!importedBy[dep]) importedBy[dep] = [];
          importedBy[dep].push(fullPath);
        }
      }
    }
  }

  if (fs.existsSync(srcDir)) walk(srcDir);
  return { imports, importedBy };
}

function detectClusters(fileDeps) {
  const allFiles = new Set([
    ...Object.keys(fileDeps.imports),
    ...Object.keys(fileDeps.importedBy),
    ...Object.values(fileDeps.imports).flat(),
    ...Object.values(fileDeps.importedBy).flat(),
  ]);

  const labels = {};
  for (const file of allFiles) {
    const parts = file.split('/');
    if (parts.includes('modules') && parts.indexOf('modules') + 2 < parts.length) {
      const idx = parts.indexOf('modules');
      labels[file] = parts.slice(idx, idx + 2).join('/');
    } else if (parts.includes('src') && parts.indexOf('src') + 2 < parts.length) {
      labels[file] = parts[parts.indexOf('src') + 1];
    } else {
      labels[file] = 'root';
    }
  }

  for (let iter = 0; iter < 5; iter++) {
    for (const file of allFiles) {
      const neighbors = [...(fileDeps.imports[file] || []), ...(fileDeps.importedBy[file] || [])];
      if (neighbors.length === 0) continue;
      const counts = {};
      for (const n of neighbors) { const l = labels[n] || 'unknown'; counts[l] = (counts[l] || 0) + 1; }
      const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      if (best && best[1] > 1) labels[file] = best[0];
    }
  }

  const clusters = {};
  for (const [file, label] of Object.entries(labels)) {
    if (!clusters[label]) clusters[label] = [];
    clusters[label].push(file);
  }
  return clusters;
}

const srcDir = path.resolve(process.cwd(), 'src');
console.log(`Building file deps from: ${srcDir}`);

const fileDeps = buildFileDeps(srcDir);
fs.writeFileSync(path.join(joernDir, 'file-deps.json'), JSON.stringify(fileDeps, null, 2));
console.log(`Wrote file-deps.json (${Object.keys(fileDeps.imports).length} files with imports)`);

const clusters = detectClusters(fileDeps);
fs.writeFileSync(path.join(joernDir, 'clusters.json'), JSON.stringify(clusters, null, 2));
console.log(`Wrote clusters.json (${Object.keys(clusters).length} clusters)`);
```

---

## C11. Tests

### C11.1 JoernAnalyzer tests

File: `src/modules/knowledge-joern/JoernAnalyzer.test.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { JoernAnalyzer } from './JoernAnalyzer';

describe('JoernAnalyzer', () => {
  let analyzer: JoernAnalyzer;

  beforeEach(() => {
    analyzer = new JoernAnalyzer();
    (analyzer as any).index = {
      metadata: { timestamp: '2026-04-06T00:00:00Z', commit: 'abc123', joernVersion: '4.0.0', fileCount: 10, schemaVersion: 1 },
      fileDeps: {
        imports: {
          'src/core/orchestrator.ts': ['src/core/prompt.ts', 'src/core/sandbox.ts', 'src/core/registry.ts', 'src/types.ts'],
          'src/core/prompt.ts': ['src/core/types.ts', 'src/types.ts'],
          'src/core/sandbox.ts': ['src/core/registry.ts', 'src/services/GlobalVars.ts'],
          'src/App.tsx': ['src/core/orchestrator.ts', 'src/core/host.ts'],
        },
        importedBy: {
          'src/core/prompt.ts': ['src/core/orchestrator.ts'],
          'src/core/sandbox.ts': ['src/core/orchestrator.ts'],
          'src/core/registry.ts': ['src/core/orchestrator.ts', 'src/core/sandbox.ts'],
          'src/types.ts': ['src/core/orchestrator.ts', 'src/core/prompt.ts'],
          'src/core/types.ts': ['src/core/prompt.ts'],
          'src/services/GlobalVars.ts': ['src/core/sandbox.ts'],
          'src/core/orchestrator.ts': ['src/App.tsx'],
          'src/core/host.ts': ['src/App.tsx'],
        },
      },
      usages: {},
      clusters: {
        'core': ['src/core/orchestrator.ts', 'src/core/prompt.ts', 'src/core/sandbox.ts'],
        'services': ['src/services/GlobalVars.ts'],
        'app': ['src/App.tsx'],
      },
    };
    (analyzer as any).loaded = true;
  });

  describe('traceImpact', () => {
    it('returns seed files at depth 0', () => {
      const result = analyzer.traceImpact(['src/core/types.ts'], 0);
      expect(result.affectedFiles).toContain('src/core/types.ts');
    });

    it('traces direct dependents at depth 1', () => {
      const result = analyzer.traceImpact(['src/core/types.ts'], 1);
      expect(result.affectedFiles).toContain('src/core/prompt.ts');
    });

    it('traces transitive dependents', () => {
      const result = analyzer.traceImpact(['src/core/types.ts'], 5);
      expect(result.affectedFiles).toContain('src/core/orchestrator.ts');
      expect(result.affectedFiles).toContain('src/App.tsx');
    });

    it('returns empty when not loaded', () => {
      (analyzer as any).loaded = false;
      expect(analyzer.traceImpact(['x.ts']).affectedFiles).toEqual([]);
    });
  });

  describe('computeOverlap', () => {
    it('detects overlap', () => {
      const result = analyzer.computeOverlap(['src/core/prompt.ts'], ['src/core/sandbox.ts']);
      expect(result.sharedFiles).toContain('src/core/orchestrator.ts');
      expect(result.safe).toBe(false);
    });

    it('reports safe when no overlap', () => {
      expect(analyzer.computeOverlap(['src/App.tsx'], ['src/services/GlobalVars.ts']).safe).toBe(true);
    });
  });

  describe('suggestTaskSplit', () => {
    it('marks non-overlapping items as independent', () => {
      const result = analyzer.suggestTaskSplit([
        { id: '1', title: 'CSS', estimatedFiles: ['src/App.tsx'] },
        { id: '2', title: 'Service', estimatedFiles: ['src/services/GlobalVars.ts'] },
      ]);
      expect(result.independent.length).toBe(2);
      expect(result.merged.length).toBe(0);
    });

    it('merges overlapping items', () => {
      const result = analyzer.suggestTaskSplit([
        { id: '1', title: 'Types', estimatedFiles: ['src/types.ts'] },
        { id: '2', title: 'Core types', estimatedFiles: ['src/core/types.ts'] },
      ]);
      expect(result.independent.length).toBe(0);
      expect(result.merged.length).toBe(1);
      expect(result.merged[0].ids).toContain('1');
      expect(result.merged[0].ids).toContain('2');
    });

    it('handles partial overlap in 3+ items', () => {
      const result = analyzer.suggestTaskSplit([
        { id: '1', title: 'CSS', estimatedFiles: ['src/App.tsx'] },
        { id: '2', title: 'Types', estimatedFiles: ['src/types.ts'] },
        { id: '3', title: 'Core types', estimatedFiles: ['src/core/types.ts'] },
      ]);
      expect(result.independent.length).toBe(1);
      expect(result.independent[0].id).toBe('1');
      expect(result.merged[0].ids.sort()).toEqual(['2', '3']);
    });

    it('returns empty when not loaded', () => {
      (analyzer as any).loaded = false;
      expect(analyzer.suggestTaskSplit([{ id: '1', title: 'X', estimatedFiles: ['a.ts'] }]).independent).toEqual([]);
    });
  });

  describe('getFileDependencies', () => {
    it('returns imports and reverse deps', () => {
      const deps = analyzer.getFileDependencies('src/core/orchestrator.ts');
      expect(deps.imports).toContain('src/core/prompt.ts');
      expect(deps.importedBy).toContain('src/App.tsx');
    });

    it('returns empty for unknown file', () => {
      const deps = analyzer.getFileDependencies('unknown.ts');
      expect(deps.imports).toEqual([]);
    });
  });

  describe('getClusters', () => {
    it('returns cluster data', () => {
      expect(Object.keys(analyzer.getClusters()).length).toBeGreaterThan(0);
    });
  });
});
```

### C11.2 Architect config tests

File: `src/modules/architect-config.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { needsRegeneration, collectCapabilities, getArchitectPrompt } from '../core/architect-config';
import { ModuleManifest } from '../types';

describe('needsRegeneration', () => {
  it('returns true when no config exists', () => {
    expect(needsRegeneration(undefined, [])).toBe(true);
  });

  it('returns false when modules match', () => {
    const config = { id: 'default', generatedAt: '', generatedConstitution: '', userNotes: '', activeModules: ['a', 'b'] };
    const modules = [{ id: 'a' }, { id: 'b' }] as ModuleManifest[];
    expect(needsRegeneration(config, modules)).toBe(false);
  });

  it('returns true when modules changed', () => {
    const config = { id: 'default', generatedAt: '', generatedConstitution: '', userNotes: '', activeModules: ['a'] };
    const modules = [{ id: 'a' }, { id: 'b' }] as ModuleManifest[];
    expect(needsRegeneration(config, modules)).toBe(true);
  });
});

describe('collectCapabilities', () => {
  it('collects capabilities from all modules', () => {
    const modules = [
      { id: 'm1', capabilities: [{ action: 'a1', description: 'd1', tools: ['t1'], suggestedWhen: 'w1' }] },
      { id: 'm2', capabilities: [{ action: 'a2', description: 'd2', tools: ['t2'], suggestedWhen: 'w2' }] },
    ] as ModuleManifest[];
    const caps = collectCapabilities(modules);
    expect(caps.length).toBe(2);
    expect(caps[0].module).toBe('m1');
    expect(caps[1].module).toBe('m2');
  });

  it('skips modules without capabilities', () => {
    const modules = [
      { id: 'm1', capabilities: [{ action: 'a1', description: 'd1', tools: ['t1'], suggestedWhen: 'w1' }] },
      { id: 'm2' },
    ] as ModuleManifest[];
    expect(collectCapabilities(modules).length).toBe(1);
  });
});

describe('getArchitectPrompt', () => {
  it('merges generated constitution and user notes', () => {
    const config = { id: 'default', generatedAt: '', generatedConstitution: 'MY RULES', userNotes: 'MY NOTES', activeModules: [] };
    const prompt = getArchitectPrompt(config);
    expect(prompt).toContain('MY RULES');
    expect(prompt).toContain('MY NOTES');
  });
});
```

---

## C12. Implementation Checklist

| # | Task | Files | Est. LOC |
|---|---|---|---|
| 1 | Create `manifest.json` with capabilities | `src/modules/knowledge-joern/manifest.json` | 60 |
| 2 | Create `types.ts` | `src/modules/knowledge-joern/types.ts` | 60 |
| 3 | Create `JoernAnalyzer.ts` | `src/modules/knowledge-joern/JoernAnalyzer.ts` | 150 |
| 4 | Create `architect-config.ts` | `src/core/architect-config.ts` | 80 |
| 5 | Add `capabilities` to `ModuleManifest` | `src/types.ts` | 8 |
| 6 | Register in registry | `src/core/registry.ts` | 1 |
| 7 | Add joern routing in `moduleRequest` | `src/core/orchestrator.ts` | 15 |
| 8 | Add constitution init + prompt in orchestrator | `src/core/orchestrator.ts` | 15 |
| 9 | Add DB migration v17 (architectConfigs table) | `src/services/db.ts` | 5 |
| 10 | Create GitHub Action | `.github/workflows/joern-index.yml` | 50 |
| 11 | Create post-processing script | `scripts/joern-postprocess.js` | 100 |
| 12 | Write JoernAnalyzer tests | `src/modules/knowledge-joern/JoernAnalyzer.test.ts` | 100 |
| 13 | Write architect config tests | `src/modules/architect-config.test.ts` | 50 |
| | **Total** | | **~700 LOC** |

---

## C13. What Changed vs Previous Version

| Aspect | Before | After |
|---|---|---|
| Architect prompt | Hardcoded with impact data baked in | Self-generated constitution from module capabilities |
| Module registration | `tools` + `sandboxBindings` | + `capabilities` declaring what the module enables |
| Config persistence | None | `ArchitectConfig` in DB (generated + user notes) |
| User control | None | User notes persist across regenerations |
| Tool access | Only Programmer Agent via sandbox | Both architect (function-calling) and programmer (sandbox) |
| New modules | Require prompt changes | Architect auto-regenerates constitution |
