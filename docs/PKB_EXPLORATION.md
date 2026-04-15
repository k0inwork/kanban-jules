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

## Recommendation: Code Graph (Approach 4) + Event Sourcing Feed (Approach 5)

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
