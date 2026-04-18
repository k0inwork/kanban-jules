# Project Knowledge Base: Implementation Exploration

> How to build a knowledge base that's browsable and projectable at different levels of detail, in a browser environment.

---

## The Problem

The system needs to accumulate structured knowledge about a project (architecture, decisions, errors, patterns) and serve it to different consumers at different detail levels. This is fundamentally a **knowledge representation and retrieval** problem.

Hard constraints:
- Runs entirely in the browser (no server-side DB)
- Must survive page reloads (IndexedDB is our persistence layer)
- Must be queryable by layer (strategic / tactical / operational)
- Must grow organically as the system works (not pre-defined)
- Must support compression/consolidation (dreaming)

---

## Approach 1: Knowledge Graph (IndexedDB-backed)

### The Idea

Store knowledge as a **graph of typed nodes and edges** in IndexedDB. Nodes represent entities (files, decisions, errors, executors, tasks). Edges represent relationships (caused-by, depends-on, discovered-in, failed-at). Projection = graph traversal with depth limits.

### Schema

```
Nodes:
  id: string (uuid)
  type: 'file' | 'module' | 'decision' | 'error' | 'pattern' | 'executor' | 'task' | 'concept'
  label: string (human-readable name)
  properties: Record<string, any> (flexible payload)
  abstraction: number (0 = concrete/raw, 10 = highly abstract)
  created: number
  updated: number
  source: string (what created this node: 'scan', 'execution', 'dream', 'user')

Edges:
  id: string
  from: string (node id)
  to: string (node id)
  type: 'contains' | 'depends-on' | 'caused-by' | 'resolved-by' | 'learned-from'
       | 'relates-to' | 'implements' | 'failed-at' | 'succeeded-at' | 'overrides'
  weight: number (0-1, how strong the relationship)
  created: number
```

### How Projection Works

Projection = **seeded traversal with abstraction filter**.

```
project(layer):
  if L0 (strategic):
    seed = root nodes (project, executors, constitution)
    depth = 2
    abstraction_min = 6  (only abstract/synthesized nodes)
    
  if L1 (tactical):
    seed = stage node, task nodes, gap nodes
    depth = 2
    abstraction_min = 3  (mid-level detail)
    
  if L2 (operational):
    seed = specific task node, executor node
    depth = 3
    abstraction_min = 0  (full detail for this subgraph)
    filter = only nodes connected to this task/executor
```

The `abstraction` field is key. Raw data (file contents, log lines) has abstraction=0. Synthesized patterns (error summaries) have abstraction=5-7. Strategic concepts (project-level insights) have abstraction=8-10. Dreaming moves nodes up the abstraction scale.

### Pros
- Natural representation of relationships
- Traversal gives you zoom-in/zoom-out for free
- Graph queries are intuitive: "show me everything related to executor-jules failures"
- Dreaming = creating higher-abstraction nodes that summarize clusters of lower ones
- Edges carry provenance (you can trace why the system believes something)

### Cons
- No native graph DB in the browser (must build on IndexedDB)
- Graph traversal on IndexedDB is many small reads (performance concern)
- Schema flexibility is a double-edged sword (can become messy)

### Implementation: ~200 LOC

```typescript
// Dexie tables
db.version(N).stores({
  kbNodes: 'id, type, abstraction, source, updated',
  kbEdges: 'id, from, to, type, weight'
});

class KnowledgeGraph {
  async addNode(node: KBNode): Promise<string> { ... }
  async addEdge(edge: KBEdge): Promise<string> { ... }
  
  async traverse(seedIds: string[], opts: {
    depth: number,
    abstractionMin?: number,
    abstractionMax?: number,
    edgeTypes?: string[],
    nodeTypes?: string[],
    maxNodes?: number
  }): Promise<KBNode[]> {
    // BFS from seeds, respecting filters
  }
  
  async project(layer: 'L0' | 'L1' | 'L2', context?: any): Promise<string> {
    const nodes = await this.traverse(this.seedsFor(layer, context), this.optsFor(layer));
    return this.render(nodes, layer); // format for LLM consumption
  }
}
```

---

## Approach 2: RAG (Retrieval-Augmented Generation)

### The Idea

Store knowledge as **text chunks with embeddings** in IndexedDB. Each chunk is a paragraph-sized piece of knowledge (a decision, an error summary, a file description). Retrieval = vector similarity search against the current query.

### Schema

```
Chunks:
  id: string
  text: string (the knowledge chunk, 100-500 tokens)
  type: 'architecture' | 'decision' | 'error' | 'pattern' | 'constitution' | 'observation'
  embedding: Float32Array (384-dimensional from a small model)
  abstraction: number (0-10)
  layer_relevance: number[] (weights for [L0, L1, L2])
  source: string
  created: number
  updated: number
  tags: string[] (for hard filtering: executor name, task type, etc.)
```

### How Projection Works

Each layer formulates a query, then retrieves the top-K most relevant chunks:

```
project(L0, query="What's the project state?"):
  filter: layer_relevance[0] > 0.5
  retrieve: top-20 chunks by cosine similarity to query embedding
  rerank: by abstraction (prefer high-abstraction chunks)
  
project(L2, query="How to write tests for auth module?"):
  filter: tags includes 'executor-jules' OR 'testing' OR 'auth'
  filter: layer_relevance[2] > 0.3
  retrieve: top-10 chunks by cosine similarity
  rerank: by recency + relevance
```

### Embedding in Browser

The hard part. Options:

1. **Transformers.js** -- run a small embedding model (all-MiniLM-L6-v2, ~80MB) directly in the browser via WASM. ~50ms per embedding. Works offline.

2. **LLM-generated embeddings** -- use the existing Gemini API to get embeddings. Costs API calls but no local model needed.

3. **TF-IDF / BM25** -- no neural embeddings. Pure keyword-based retrieval. Simpler, faster, no model needed. Less semantic understanding but surprisingly effective for structured technical text.

4. **Hash-based similarity** -- MinHash or SimHash for fast approximate similarity. Very cheap, works for detecting near-duplicates and related content.

### Pros
- Handles unstructured knowledge well (decisions described in natural language)
- Retrieval is query-driven (each layer asks what it needs)
- Scales to large knowledge bases (vector search is O(n) but fast with small n)
- Dreaming = re-embedding compressed summaries, deleting raw chunks

### Cons
- Embedding model is large (~80MB) or requires API calls
- Loses structural relationships (graph edges) -- "X caused Y" becomes two separate chunks
- Relevance depends on embedding quality
- Hard to guarantee coverage (might miss relevant chunks that don't match the query embedding)

### Implementation: ~300 LOC (with TF-IDF, no neural model)

```typescript
class KnowledgeRAG {
  async addChunk(chunk: KBChunk): Promise<string> { ... }
  
  async retrieve(query: string, opts: {
    topK: number,
    layerFilter: number,  // 0, 1, or 2
    tags?: string[],
    abstractionMin?: number
  }): Promise<KBChunk[]> {
    // TF-IDF scoring against all chunks matching filters
  }
  
  async project(layer: 'L0' | 'L1' | 'L2', context?: any): Promise<string> {
    const query = this.queryFor(layer, context);
    const chunks = await this.retrieve(query, this.optsFor(layer));
    return chunks.map(c => c.text).join('\n\n');
  }
}
```

---

## Approach 3: Multi-Structure Store (Hybrid)

### The Idea

Don't force everything into one representation. Different types of knowledge have different natural structures:

| Knowledge type | Natural structure | Best queried by |
|---------------|-------------------|----------------|
| Project architecture | **Tree** (dir → module → file → function) | Path traversal |
| Task/error history | **Timeline** (ordered by time) | Time range + filters |
| Decisions & rationale | **Document** (text with tags) | Keyword / semantic search |
| Executor profiles | **Table** (key-value per executor) | Direct lookup |
| Relationships (X caused Y) | **Graph** (nodes + edges) | Traversal |
| Constitution & rules | **Document** (structured text) | Section lookup |
| Patterns & learnings | **Index** (type → entries) | Type + relevance |

### Schema

Instead of one universal store, use **specialized sub-stores** unified by a projection layer:

```
kb_tree:      id, parentId, type, label, properties, depth
kb_timeline:  id, timestamp, type, taskId, executorId, summary, detail
kb_documents: id, type, title, content, tags, abstraction
kb_profiles:  id (executor name), properties (JSON)
kb_graph:     id, from, to, edgeType, weight
```

### How Projection Works

The projection function queries each sub-store and assembles a composite view:

```typescript
async project(layer: 'L0' | 'L1' | 'L2', context?): Promise<string> {
  const sections = [];
  
  if (layer === 'L0') {
    sections.push(await this.tree.summarize(depth=1));      // top-level architecture
    sections.push(await this.timeline.recent(limit=5));       // recent activity
    sections.push(await this.profiles.all());                 // executor profiles
    sections.push(await this.documents.byType('decision', limit=5, abstractionMin=5));
    sections.push(await this.documents.byType('constitution'));
  }
  
  if (layer === 'L2') {
    const { taskId, executor } = context;
    sections.push(await this.tree.subtree(context.relevantPath));  // relevant files
    sections.push(await this.timeline.forTask(taskId));            // this task's history
    sections.push(await this.profiles.get(executor));              // executor tips
    sections.push(await this.documents.byTags([executor, taskId], abstractionMin=0));
    sections.push(await this.graph.neighbors(taskId, depth=1));    // related errors/decisions
  }
  
  return this.format(sections, layer);
}
```

### Pros
- Each knowledge type stored in its natural shape
- Queries are simple and fast (no impedance mismatch)
- Easy to add new knowledge types without restructuring
- Clear separation of concerns

### Cons
- Multiple tables to manage
- Cross-store queries are manual (the projection function does the joining)
- More code to maintain
- Risk of data inconsistency across stores

### Implementation: ~400 LOC

---

## Approach 4: Code Graph (Novel -- Fits Browser)

### The Idea

Inspired by the existing [`docs/code-graph.md`](docs/code-graph.md) work in this repo. Represent all knowledge as a **labeled property graph** stored in a single IndexedDB table with **adjacency lists serialized as JSON**. This is the lightest-weight graph DB you can build in a browser.

### Why a Single Table

IndexedDB transactions across multiple tables are slow. A single-table design with denormalized adjacency lists gives you:
- One read to get a node + all its edges
- One write to update a node + its edges
- No joins, no foreign key lookups

### Schema

```
kb_nodes:
  id: string (primary key)
  type: string
  label: string
  abstraction: number (0-10)
  data: any (flexible payload -- the actual knowledge content)
  edges_out: Array<{ to: string, type: string, weight: number }>
  edges_in: Array<{ from: string, type: string, weight: number }>
  tags: string[]
  created: number
  updated: number
  ttl: number | null (for auto-pruning: null = permanent)
```

### Node Types and Their Natural Shapes

```
project (root)
  ├── module (architecture)
  │   ├── file
  │   │   └── function/export
  │   └── dependency
  ├── executor
  │   ├── profile_entry (success/failure data point)
  │   └── known_pattern
  ├── task
  │   ├── step
  │   │   └── tool_call (ephemeral, high TTL pruning)
  │   ├── error
  │   └── artifact
  ├── decision
  │   ├── rationale
  │   └── rejected_alternative
  ├── pattern (learned)
  │   ├── evidence (links to tasks/errors that demonstrate it)
  │   └── recommendation
  └── constitution_rule
      └── amendment (proposed or approved)
```

### Smart Traversal with Abstraction Budgets

Instead of fixed depth limits, use a **token budget**. The traversal expands nodes until the budget is exhausted, preferring higher-abstraction nodes:

```typescript
async projectWithBudget(seeds: string[], budget: number, abstractionMin: number): Promise<KBNode[]> {
  const result: KBNode[] = [];
  const queue = new PriorityQueue<{ id: string, priority: number }>();
  const visited = new Set<string>();
  let tokensUsed = 0;
  
  // Seed the queue
  for (const id of seeds) {
    queue.push({ id, priority: 100 }); // seeds get highest priority
  }
  
  while (!queue.isEmpty() && tokensUsed < budget) {
    const { id } = queue.pop();
    if (visited.has(id)) continue;
    visited.add(id);
    
    const node = await db.kbNodes.get(id);
    if (!node || node.abstraction < abstractionMin) continue;
    
    const nodeTokens = estimateTokens(node);
    if (tokensUsed + nodeTokens > budget) continue;
    
    result.push(node);
    tokensUsed += nodeTokens;
    
    // Expand neighbors, prioritized by edge weight * node abstraction
    for (const edge of node.edges_out) {
      if (!visited.has(edge.to)) {
        const neighbor = await db.kbNodes.get(edge.to);
        if (neighbor) {
          queue.push({ 
            id: edge.to, 
            priority: edge.weight * neighbor.abstraction 
          });
        }
      }
    }
  }
  
  return result;
}
```

### Dreaming as Graph Compression

Dreaming creates new abstract nodes that summarize clusters:

```
Before dreaming:
  error-1 (abs=1): "Jules timed out on large refactor"
  error-2 (abs=1): "Jules timed out on monorepo config"  
  error-3 (abs=1): "Jules timed out on auth rewrite"

After dreaming:
  pattern-X (abs=7): "Jules times out on tasks >500 LOC"
    ├── evidence → error-1
    ├── evidence → error-2
    └── evidence → error-3
    
  The raw errors get TTL set (prune in 7 days).
  The pattern node is permanent.
```

### Pros
- Single table = fast IndexedDB transactions
- Denormalized adjacency = one read per node expansion
- Token-budgeted traversal = guaranteed fit in context window
- Abstraction field enables natural zoom in/out
- TTL on nodes enables automatic pruning without losing synthesized knowledge
- Graph compression (dreaming) is a natural operation

### Cons
- Denormalized edges = must update both sides on edge create/delete
- No native graph query language (must implement traversal manually)
- Single table could get large (but IndexedDB handles millions of rows fine)

### Implementation: ~250 LOC

---

## Approach 5: Event Sourcing + Materialized Views

### The Idea

Don't build a knowledge base -- build an **event log**. Every observation, every decision, every error is an immutable event. Views (projections) are computed on demand by replaying/querying events.

### Schema

```
kb_events:
  id: auto-increment
  timestamp: number
  type: 'observed' | 'decided' | 'failed' | 'learned' | 'corrected' | 'dreamed'
  category: 'architecture' | 'executor' | 'task' | 'pattern' | 'constitution' | 'user'
  subject: string (what this is about: file path, executor name, task id)
  data: any (event payload)
  abstraction: number (0-10)
  supersedes: number | null (id of event this replaces -- for compression)
```

### How Projection Works

Views are materialized by scanning events:

```typescript
async project(layer: 'L0' | 'L1' | 'L2', context?): Promise<string> {
  let events: KBEvent[];
  
  if (layer === 'L0') {
    // Strategic: recent events, high abstraction, all categories
    events = await db.kbEvents
      .where('abstraction').aboveOrEqual(5)
      .reverse().sortBy('timestamp')
      .limit(50);
  }
  
  if (layer === 'L2') {
    // Operational: events about this task/executor, any abstraction
    events = await db.kbEvents
      .where('subject').anyOf([context.taskId, context.executor])
      .reverse().sortBy('timestamp')
      .limit(30);
  }
  
  // Filter out superseded events
  const superseded = new Set(events.filter(e => e.supersedes).map(e => e.supersedes));
  events = events.filter(e => !superseded.has(e.id));
  
  return this.format(events, layer);
}
```

### Dreaming as Event Consolidation

```
// Before: 10 individual error events about Jules timeouts
// After: 1 'dreamed' event summarizing the pattern, superseding all 10

await db.kbEvents.add({
  type: 'dreamed',
  category: 'pattern',
  subject: 'executor-jules',
  data: { summary: 'Jules times out on tasks >500 LOC', recurrence: 10 },
  abstraction: 7,
  supersedes: null  // Doesn't supersede -- the raw events get TTL'd separately
});
```

### Pros
- Simplest possible schema (one table, append-only)
- Full history preserved (nothing lost, even after dreaming)
- Time-travel: can reconstruct PKB state at any point
- Events are naturally ordered (timeline queries are free)
- `supersedes` chain gives clean consolidation

### Cons
- Views are computed on every read (can cache, but adds complexity)
- No structural relationships (events are flat, not graph)
- Scaling: scanning 10K events per projection gets slow
- Hard to answer "what's related to X?" without a relationship model

### Implementation: ~150 LOC

---

## Phase 0 MVP: Tagged Log with Dreaming Appends

### The Simplest Thing That Could Work

Start with an append-only log. Every observation, decision, error, and consolidation is just another entry. Entries have tags and flags that enable filtering by layer, abstraction level, category, and subject. Dreaming doesn't transform entries -- it **appends new higher-level entries** that summarize clusters of older ones.

No graph. No embeddings. No multiple tables. Just a log.

### Schema

```
kb_log:
  id: auto-increment
  timestamp: number
  
  // Content
  text: string          (human-readable knowledge chunk, 1-3 sentences)
  
  // Flags (drive filtering and projection)
  category: string      ('architecture' | 'decision' | 'error' | 'pattern' | 
                          'executor' | 'constitution' | 'observation' | 'dream')
  abstraction: number   (0 = raw observation, 5 = synthesized, 10 = strategic insight)
  layer: string[]       (['L0'] | ['L1'] | ['L2'] | ['L0','L1'] | ['L0','L1','L2'])
  
  // Tags (free-form, enable flexible filtering)
  tags: string[]        (['executor-jules', 'timeout', 'auth-module', 'task-123', ...])
  
  // Provenance
  source: string        ('scan' | 'execution' | 'dream:micro' | 'dream:session' | 
                          'dream:deep' | 'user' | 'process-planner')
  supersedes: number[]  (ids of entries this one summarizes -- empty for raw entries)
  
  // Lifecycle
  active: boolean       (false = superseded/pruned, still queryable but excluded by default)
```

### How It Works

**Recording**: Every time the system learns something, append a log entry:

```
// Task step fails
append({ 
  text: "Jules timed out on auth-module refactor (>30s, attempt 2/5)",
  category: 'error', 
  abstraction: 1, 
  layer: ['L2'],
  tags: ['executor-jules', 'timeout', 'auth-module', 'task-abc'],
  source: 'execution',
  supersedes: [],
  active: true
})

// Repo scan discovers structure
append({
  text: "Project uses React 19 + TypeScript + Go/WASM. Key dirs: src/core/, src/modules/, wasm/",
  category: 'architecture',
  abstraction: 3,
  layer: ['L0', 'L1'],
  tags: ['react', 'typescript', 'wasm', 'structure'],
  source: 'scan',
  supersedes: [],
  active: true
})
```

**Projection**: Filter by layer + abstraction + active status, sorted by relevance:

```typescript
async project(layer: 'L0' | 'L1' | 'L2', opts?: { 
  tags?: string[], 
  budget?: number,  // max tokens
  category?: string 
}): Promise<string> {
  
  let entries = await db.kbLog
    .where('active').equals(1)
    .filter(e => e.layer.includes(layer))
    .toArray();
  
  // For L0: prefer high abstraction
  // For L2: prefer low abstraction + matching tags
  if (layer === 'L0') {
    entries.sort((a, b) => b.abstraction - a.abstraction || b.timestamp - a.timestamp);
  } else if (layer === 'L2' && opts?.tags) {
    entries = entries.filter(e => e.tags.some(t => opts.tags!.includes(t)));
    entries.sort((a, b) => a.abstraction - b.abstraction || b.timestamp - a.timestamp);
  } else {
    entries.sort((a, b) => b.timestamp - a.timestamp);
  }
  
  // Fill token budget
  const budget = opts?.budget || 1500;
  let tokens = 0;
  const selected: KBLogEntry[] = [];
  for (const entry of entries) {
    const entryTokens = Math.ceil(entry.text.length / 4);
    if (tokens + entryTokens > budget) break;
    selected.push(entry);
    tokens += entryTokens;
  }
  
  return selected.map(e => `[${e.category}] ${e.text}`).join('\n');
}
```

**Dreaming**: Append a new higher-abstraction entry that summarizes older ones:

```typescript
async microDream(taskId: string, llmCall): Promise<void> {
  // Gather raw entries for this task
  const raw = await db.kbLog
    .where('active').equals(1)
    .filter(e => e.tags.includes(taskId) && e.abstraction <= 2)
    .toArray();
  
  if (raw.length < 3) return; // not enough to consolidate
  
  // LLM summarizes
  const summary = await llmCall(`
    Summarize these ${raw.length} observations into 1-2 sentences.
    Focus on: what happened, what worked, what failed.
    Entries: ${raw.map(e => e.text).join('\n')}
  `);
  
  // Append consolidated entry
  await db.kbLog.add({
    timestamp: Date.now(),
    text: summary,
    category: 'dream',
    abstraction: 5,
    layer: ['L0', 'L1'],
    tags: [...new Set(raw.flatMap(e => e.tags))],
    source: 'dream:micro',
    supersedes: raw.map(e => e.id),
    active: true
  });
  
  // Mark raw entries as inactive (still in DB, just excluded from default queries)
  for (const entry of raw) {
    await db.kbLog.update(entry.id, { active: false });
  }
}
```

### What the Log Looks Like Over Time

```
Day 1 (seed):
  #1  [constitution] "Always test auth changes before merge" (abs=8, L0/L1/L2, user)
  #2  [architecture] "React 19 + TS + Go/WASM, 11 modules" (abs=3, L0/L1, scan)
  #3  [architecture] "Key dirs: src/core, src/modules, wasm/boot" (abs=2, L1/L2, scan)

Day 1 (execution):
  #4  [error] "Jules timed out on auth refactor (30s)" (abs=1, L2, execution)
  #5  [error] "Jules timed out on auth refactor attempt 2" (abs=1, L2, execution)
  #6  [decision] "Broke auth refactor into 3 smaller tasks" (abs=4, L0/L1, execution)
  #7  [observation] "executor-jules: 2 timeouts on tasks >500 LOC" (abs=2, L2, execution)

Day 1 (micro-dream after task):
  #8  [dream] "Jules fails on large refactors (>500 LOC). Breaking into chunks works."
              (abs=5, L0/L1, dream:micro, supersedes=[4,5,7])
  → entries #4, #5, #7 marked active=false

Day 2 (more execution):
  #9  [error] "Jules timed out on migration script" (abs=1, L2, execution)
  #10 [observation] "executor-local: 100% success on file ops" (abs=2, L1/L2, execution)

Day 2 (session-dream):
  #11 [dream] "Executor-jules: 70% success overall. Fails on >500 LOC tasks (3 timeouts).
               Executor-local: 100% success on file operations. No failures."
              (abs=7, L0, dream:session, supersedes=[8,9,10])
  → entries #8, #9, #10 marked active=false

Now L0 sees: #1, #2, #6, #11 (4 high-abstraction entries)
    L1 sees: #1, #2, #3, #6, #11 (5 mid-level entries)
    L2 sees: #1, #3 + any active tagged entries for the specific task
```

### Why Start Here

1. **~100 LOC to implement** (one Dexie table, project function, micro-dream)
2. **Zero new concepts** -- it's just a filtered log
3. **Dreaming is just appending** -- no graph compression, no embedding, no structural changes
4. **Tags are flexible** -- add new tag types without schema changes
5. **Abstraction is a simple number** -- higher = more consolidated, lower = more raw
6. **Upgradeable** -- if you later need a graph, you can build it as an index over this log. The log becomes the event source, the graph becomes a materialized view.

### Migration Path to Graph

When the log approach hits limits (can't answer "what's related to X?" efficiently), add a graph index:

```
Phase 0: Tagged log (MVP) .............. ~100 LOC
Phase 1: Add graph index over log ...... +150 LOC  (graph nodes reference log entry IDs)
Phase 2: Token-budgeted traversal ...... +100 LOC  (priority queue expansion)
Phase 3: Full PKB module ............... +250 LOC  (manifest, handlers, dreaming levels)
```

Each phase is additive. The log is never replaced -- it becomes the audit trail behind the graph.

---

## Future: Code Graph (Approach 4) + Event Sourcing Feed (Approach 5)

### Why Both

The graph gives you **structure** (relationships, traversal, zoom). The event feed gives you **history** (what happened, when, what changed). Together:

- **Graph** = the current state of knowledge (what the system believes right now)
- **Event feed** = how it got there (immutable audit trail)
- **Dreaming** operates on both: creates abstract graph nodes AND consolidation events

### Combined Schema

```
// Current state (browsable, projectable)
kb_nodes: id, type, label, abstraction, data, edges_out, edges_in, tags, ttl, updated

// History (immutable, auditable)
kb_events: id, timestamp, type, category, subject, data, abstraction, supersedes
```

### Module Architecture

Build this as a new module: `knowledge-project-kb`.

```
src/modules/knowledge-project-kb/
  manifest.json         -- module declaration
  ProjectKB.ts          -- main class (graph + events + projections)
  KBGraph.ts            -- graph operations (add/traverse/compress)
  KBEvents.ts           -- event sourcing (append/query/supersede)
  KBProjector.ts        -- layer projections (L0/L1/L2 views)
  KBDreamer.ts          -- consolidation logic (micro/session/deep)
  types.ts              -- KBNode, KBEdge, KBEvent, KBProjection
```

### Manifest

```json
{
  "id": "knowledge-project-kb",
  "name": "Project Knowledge Base",
  "version": "0.1.0",
  "type": "knowledge",
  "description": "Graph-based project knowledge with layer-appropriate projections. Accumulates architecture, decisions, errors, patterns, and executor profiles.",
  "tools": [
    {
      "name": "knowledge-project-kb.browse",
      "description": "Browse the PKB at a specific layer (L0/L1/L2) or query by topic.",
      "parameters": {
        "type": "object",
        "properties": {
          "layer": { "type": "string", "enum": ["L0", "L1", "L2"] },
          "query": { "type": "string" },
          "taskId": { "type": "string" },
          "executor": { "type": "string" }
        }
      }
    },
    {
      "name": "knowledge-project-kb.record",
      "description": "Record a new observation, decision, error, or learning.",
      "parameters": {
        "type": "object",
        "properties": {
          "type": { "type": "string", "enum": ["observed", "decided", "failed", "learned", "corrected"] },
          "category": { "type": "string" },
          "subject": { "type": "string" },
          "data": { "type": "object" }
        }
      }
    },
    {
      "name": "knowledge-project-kb.dream",
      "description": "Trigger knowledge consolidation (micro, session, or deep).",
      "parameters": {
        "type": "object",
        "properties": {
          "level": { "type": "string", "enum": ["micro", "session", "deep"] }
        }
      }
    }
  ],
  "sandboxBindings": {
    "browseKB": "knowledge-project-kb.browse",
    "recordKB": "knowledge-project-kb.record"
  },
  "permissions": ["storage"]
}
```

### Token-Budgeted Projection (the key innovation)

Instead of fixed depth/limit, the projector fills a token budget greedily:

```typescript
// Yuan asks: "give me the strategic view"
const view = await pkb.browse({ layer: 'L0', budget: 2000 });

// Internally:
// 1. Start from project root + executor nodes + constitution
// 2. Expand using priority queue (weight * abstraction)
// 3. Stop when 2000 tokens consumed
// 4. Format as structured text for LLM consumption

// Output:
// "## Project: kanban-jules (collective)
//  Architecture: React 19 + TS + Go/WASM, 11 modules, graph DB for KB
//  Stage: integration (7/12 tasks done)
//  
//  ## Executor Profiles
//  jules: 85% success, weak on monorepo configs (3 timeouts this week)
//  local: 92% success, can't do shell ops
//  
//  ## Recent Decisions
//  - Broke large refactors into <500 LOC chunks (learned from jules timeouts)
//  - Added retry constitution for programmer agent
//  
//  ## Active Concerns
//  - task-abc stuck 15 min (no log output)
//  - No testing spec artifact yet (required for next stage)"
```

### Estimated Build Size

| Component | LOC |
|-----------|-----|
| `types.ts` | ~40 |
| `KBGraph.ts` (nodes + edges + traversal) | ~150 |
| `KBEvents.ts` (append + query + supersede) | ~80 |
| `KBProjector.ts` (L0/L1/L2 projections) | ~120 |
| `KBDreamer.ts` (micro/session/deep) | ~100 |
| `ProjectKB.ts` (main class, wiring) | ~60 |
| `manifest.json` | ~40 |
| Dexie schema additions | ~10 |
| **Total** | **~600** |

This is a self-contained module that slots into the existing registry. Yuan calls `browseKB({ layer: 'L0' })`. Tasks call `browseKB({ layer: 'L2', taskId, executor })`. The module handles everything internally.
