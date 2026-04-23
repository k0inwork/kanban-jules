# askUserFor — Unified User Interaction Design

## Problem

Agents (ProcessAgent, TaskAgent, System) need different types of user input:

- A quick choice (pick from options)
- A document or artifact
- A file from the repo
- A freeform multi-turn discussion leading to a structured result
- A collaborative document drafting session

Current `askUser` is single-shot: one question, one string reply. It can't handle any of the above well. Agents either flatten complex interactions into awkward single questions, or they give up and create a task like "Create needed documents."

## Proposal: `askUserFor(prompt, mode, options?)`

One function, multiple modes. The agent describes **what it needs**, not **how to get it**.

```typescript
askUserFor(prompt: string, mode: AskMode, options?: AskOptions): Promise<AskResult>
```

### Modes

```typescript
type AskMode =
  | 'choice'       // pick from a list
  | 'text'         // freeform short answer (like current askUser)
  | 'document'     // user provides or drafts a document
  | 'artifact'     // user attaches an existing artifact
  | 'file'         // user picks a file from the repo
  | 'chat'         // spawn a Yuan conversation
```

### Options

```typescript
interface AskOptions {
  // --- choice mode ---
  choices?: string[]              // e.g. ['jwt', 'oauth', 'session']

  // --- document mode ---
  documentType?: string           // e.g. 'PRD', 'constitution', 'API spec'
  template?: string               // starter content

  // --- chat mode ---
  chatStyle?: 'explorer' | 'analyst' | 'worker'
  successCriteria?: string        // natural language: "target, personas, constraints"

  // --- general ---
  timeout?: number                // ms, default 300000 (5 min)
}
```

### Result

```typescript
type AskResult = {
  mode: AskMode                   // which mode was actually used
  value: string                   // the answer / selected choice / summary
  artifactId?: number             // if a document was produced, its artifact ID
  chatId?: string                 // if a Yuan chat was spawned, its pane ID
}
```

---

## How Each Mode Works (UX)

### `choice` — Mail card with buttons

Agent needs a decision. The mail message shows buttons.

```
┌──────────────────────────────────────────┐
│ [task-42] Choose authentication approach │
│                                          │
│  ┌──────────┐ ┌───────┐ ┌────────────┐  │
│  │  JWT     │ │ OAuth │ │  Session   │  │
│  └──────────┘ └───────┘ └────────────┘  │
│                                          │
│  💬 Chat about this...                   │
└──────────────────────────────────────────┘
```

User clicks a button → resolves immediately.
If user clicks "Chat about this..." → **escalates to chat mode** with the same prompt.

### `text` — Current askUser behavior

Simple input field in the mail card. Fallback for quick questions.

### `document` — Mail card with editor/attach button

Agent needs a document (PRD, constitution, spec).

```
┌──────────────────────────────────────────┐
│ [overseer] Project constitution needed    │
│                                          │
│  Describe your project goals, or:        │
│                                          │
│  📎 Attach artifact    📁 Pick repo file │
│  📝 Open editor        💬 Draft with Yuan│
└──────────────────────────────────────────┘
```

User can:
- Type/paste directly → plain text result
- Attach existing artifact → returns artifact content
- Pick file from repo → returns file content
- Open a text editor modal → writes, submits
- "Draft with Yuan" → **escalates to chat mode** with documentType context

All paths produce an `AskResult` with `artifactId` set (the document is saved as an artifact).

### `artifact` — Mail card with artifact picker

Agent needs the user to select an existing artifact.

```
┌──────────────────────────────────────────┐
│ [task-42] Select reference architecture  │
│                                          │
│  📄 api-design-v2    (from task-38)      │
│  📄 system-overview  (from task-12)      │
│  📄 auth-flow        (from task-42)      │
│                                          │
│  💬 Discuss options with Yuan            │
└──────────────────────────────────────────┘
```

### `file` — Repo file browser modal

Opens a file picker dialog. User navigates the repo tree, picks a file. Returns file content.

### `chat` — Spawn a Yuan pane

Agent needs a multi-turn conversation. A new Yuan tab appears in the workspace.

```
┌─ [Yuan Chat]─[Yuan: Project Scope]─[Terminal]─┐
│                                                 │
│  Yuan: What are you building?                   │
│  You: A kanban app for solo devs                │
│  Yuan: Who are the users exactly? Hobbyists?    │
│  You: Indie developers managing freelance work  │
│  Yuan: Any tech constraints?                    │
│  ...                                            │
│                                                 │
│  [you]>                                         │
└─────────────────────────────────────────────────┘
```

A mail notification also appears:

```
┌──────────────────────────────────────────┐
│ [overseer] Yuan is discussing project    │
│            scope with you                 │
│                                          │
│  → Open Chat                             │
└──────────────────────────────────────────┘
```

Clicking "Open Chat" switches to the Yuan tab. The tab has a descriptive name (e.g. "Yuan: Project Scope").

**Ending the chat:** The user explicitly closes the chat by clicking **OK** (bottom bar) or **X** (tab close). Both do the same thing: Yuan summarizes the conversation, checks against success criteria, and resolves. The full conversation is saved as an artifact. If criteria aren't fully met, Yuan notes what's still missing — the caller agent decides what to do.

Yuan does NOT auto-resolve. The user is always in control of when the conversation is done.

---

## Yuan Chat Spawning (details)

### Persona by chatStyle

Each spawned Yuan chat gets a persona based on `chatStyle`:

| Style | Tools | Behavior |
|---|---|---|
| `explorer` | Read artifacts, list tasks | Socratic, draws out answers through questions |
| `analyst` | Read artifacts, list tasks, read repo files, search code | Direct, technical, presents options with tradeoffs |
| `worker` | Full tools (bash, read/write, artifacts) | Collaborative, does work alongside user |

### System prompt construction

The spawned Yuan's system prompt is built from:

1. **Base identity** — "You are Yuan, an AI assistant in a project management system."
2. **Kanban context** — brief description of the board system (tasks, artifacts, etc.)
3. **Objective** — the `prompt` from `askUserFor`
4. **Success criteria** — the `successCriteria` string
5. **Resolution instruction** — when criteria are met, output `<<<RESOLVED>>>{json}<<<END>>>`

Context injected based on persona:
- `explorer`: project artifact list + task summary (lightweight)
- `analyst`: above + repo file tree + ability to read files on demand
- `worker`: above + bash + write tools

### Lifecycle

1. Agent calls `askUserFor('Define project scope', 'chat', { successCriteria: '...', chatStyle: 'explorer' })`
2. YuanNegotiator creates a new Yuan pane + sends mail notification
3. User chats in the Yuan pane (or clicks "Open Chat" from mail)
4. User clicks **OK** or **X** when done
5. Yuan summarizes the conversation, evaluates against success criteria
6. Summary + full conversation saved as artifact, promise resolves
7. Agent receives `AskResult` with `value` (summary) and `artifactId` (full conversation)
8. Yuan tab closes

### Multiple concurrent chats

Each `askUserFor('chat')` call creates a separate Yuan pane with its own LLM context. The tab bar shows all active chats:

```
[Yuan Chat] [Scope] [Auth] [API Spec] [Terminal]
```

User tabs between them. Each resolves independently when its criteria are met.

---

## Escalation: modes can upgrade

Any mode can escalate to `chat`:

- `choice` → user clicks "Chat about this"
- `document` → user clicks "Draft with Yuan"
- `artifact` → user clicks "Discuss options"
- `text` → user clicks "Let's discuss"

This means the mail card always shows the escalation option. The Yuan chat inherits the original prompt + context, with the `successCriteria` derived from the original mode.

---

## Split View: Editor + Yuan Chat

When a mode involves a document (`document`, `artifact`, `file`, or any escalated chat that started from these), the Yuan tab shows a **split pane**: document editor on the left, Yuan chat on the right.

```
┌──────────────────────┬──────────────────────┐
│  constitution.md     │  Yuan: Project Scope  │
│                      │                       │
│  # Project: Kanban   │  Yuan: I've drafted   │
│  ## Target           │  the initial sections.│
│  A task manager for  │  Want me to expand    │
│  solo developers...  │  the tech constraints?│
│                      │                       │
│  ## Users            │  You: yes, add that   │
│  - Indie devs        │  we need browser-only │
│  - Freelancers       │                       │
│                      │  Yuan: Done, check     │
│  ## Constraints      │  the constraints      │
│  - Browser-only      │  section.             │
│  - No backend server │                       │
│                      │  [you]>               │
└──────────────────────┴──────────────────────┘
```

### When the split view appears

- `document` mode — always (user is working on a document)
- `artifact` mode — when user picks an artifact (Yuan can review/edit it)
- `file` mode — when user picks a repo file (Yuan can discuss and modify it)
- Escalated chats from document/artifact/file — inherits the attached document
- `choice`, `text`, plain `chat` — **no split view** (nothing to edit)

### Yuan's document tools (only available when split view is active)

| Tool | Description |
|---|---|
| `readAttachedDocument()` | Returns current content of the editor (includes any user edits) |
| `editAttachedDocument(commands)` | Apply sed-style edits to the document |

`editAttachedDocument` takes an array of commands:

```javascript
editAttachedDocument([
  { op: 'replace', search: '## Users', replace: '## Target Users' },
  { op: 'replace', from: '## Users', until: '## Tech Stack', replace: '## Target Users\n- Indie devs\n' },
  { op: 'insert', after: '## Constraints', content: '- Must support offline mode' },
  { op: 'delete', search: '## Deprecated Section' },
  { op: 'delete', search: '## Legacy', count: 10 },
  { op: 'delete', from: '## Old Config', until: '## New Config' },
  { op: 'append', content: '\n## Notes\nTBD' }
])
```

Operations:
- `replace` — find exact text (`search`), replace with new text. Or replace a range: `from` + `until` marks the block (inclusive), `replace` is the new content (can be empty to delete the block). Fails if anchors not found — Yuan re-reads and retries.
- `insert` — insert content after the line matching `after`
- `delete` — three forms:
  - `search` only — remove the line(s) matching the text
  - `search` + `count` — remove N lines starting from the match (inclusive)
  - `from` + `until` — remove block from first match to second match (inclusive on both ends)
- `append` — add content at the end

Range parameters (`from`/`until`, `count`) apply to `replace` and `delete` only. Ranges are inclusive — the anchor lines themselves are part of the operation.

Why sed-style over line numbers: Yuan doesn't need to guess line positions. It searches for the actual text it wants to change. Less brittle, especially after multiple edits shift line numbers.

Both tools operate on the shared editor state. User sees Yuan's edits immediately. Yuan reads the current state (including user edits) on each call. Last-write-wins — no OT/CRDT, keep it simple.

### Editor

V1: textarea with line numbers. V2: CodeMirror 6 lightweight bundle for syntax highlighting.

### Not for orchestrator

The orchestrator runs task steps in a sandbox — it doesn't chat with users or edit documents interactively. These tools are Yuan-persona-only.

---

## Artifact Attachment

All results that produce content (document, chat output, file) are automatically saved as artifacts:

- **Task context**: artifact gets `taskId` + `projectId`
- **ProcessAgent context**: artifact gets only `projectId` (project-level)

The `AskResult.artifactId` lets the caller reference the full output later.

---

## Implementation Pieces

1. **`YuanNegotiator`** — creates Yuan pane with persona, monitors for `<<<RESOLVED>>>`, resolves promise
2. **`AskUserForHandler`** — new module handler, routes modes to appropriate UX
3. **Mail card variants** — choice buttons, document attach, file picker, escalation link
4. **Yuan pane factory** — spawns xterm + LLM context with persona-based tools
5. **WorkspaceTabs extension** — dynamic Yuan chat tabs with auto-cleanup
6. **Sandbox binding** — `askUserFor` available in agent sandbox code

### Sandbox usage

```javascript
// Simple choice
const auth = await askUserFor('Choose auth approach', 'choice', {
  choices: ['jwt', 'oauth', 'session', 'none']
});

// Collaborative document
const prd = await askUserFor('Draft the PRD', 'document', {
  documentType: 'PRD'
});

// Multi-turn chat
const scope = await askUserFor('Define project scope', 'chat', {
  successCriteria: 'target description, user personas, tech constraints, definition of success',
  chatStyle: 'explorer'
});
```

---

## Open Questions

- **Chat summary on close**: When user clicks OK/X, should Yuan generate the summary via an LLM call (adds latency), or just return the raw conversation as the artifact?
- **Chat timeout**: What happens if the user never responds? Fall back to mail notification?
- **Artifact naming**: Auto-name based on objective, or let user name it?
