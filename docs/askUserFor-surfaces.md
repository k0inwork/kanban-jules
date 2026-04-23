# askUserFor Interaction Surfaces

## Overview

The `askUserFor` system lets agents ask users for input. The same question can surface in multiple places depending on user attention and context depth. This document maps the three surfaces, the routing logic, and the architectural separation needed.

---

## Use Cases

### 1. Quick answer from Mail

**Scenario:** Agent runs a migration, hits `"column 'email' doesn't exist"`. It asks: "Should I rename the column or create a new one?"

**What the user needs:** A binary decision. The agent has full context. No thinking required.

**Why mail:** Async. User checks mailbox when they want. 2-second interaction.

**Pattern:** Agent has full context → needs a decision → mail is sufficient.

**Modes:** choice, text

---

### 2. Explore with Yuan Chat

**Scenario:** Agent is building a payment integration. It asks: "Which payment provider?" The user hasn't decided. They need to think through tradeoffs, pricing, competitors.

**What the user needs:** A conversation. Socratic exploration. Someone to help them think.

**Why Yuan:** Explorer/analyst/worker persona draws out the user's thinking. No task context needed — this is a strategic question, not a tactical one.

**Pattern:** Agent hit a strategic gap → user needs to think → Yuan explores with them.

**Modes:** chat, escalation from any other mode ("Chat with Yuan about this...")

---

### 3. Chat with Task — full context

**Scenario:** Agent has been working for 20 minutes. Read 15 files, ran tests, wrote code. Now asks: "The auth middleware expects a session object but the new route uses JWT. Refactor middleware or add a bypass?"

**What the user needs:** To see what the agent has been doing. The code it read. The errors it hit.

**Why task chat:** All context is there — logs, files read, artifacts, error traces. User and agent discuss *in context*. No re-fetching.

**Pattern:** Agent has deep context → question is contextual → user needs to see the work to answer.

**Modes:** choice, text, document (inline in task chat stream)

---

## Routing Logic

```
Agent hits a question
  │
  ├─ Is it a simple factual/decision question?
  │    → Mail card (choice/text)
  │
  ├─ Is it a strategic/open-ended question?
  │    → Yuan chat (explorer/analyst/worker)
  │
  └─ Is it a context-heavy tactical question?
       → Task chat (inline in task panel)
```

## Escalation Chain

A question can move up in depth:

```
Mail answer ──→ "Take to task" ──→ Task chat ──→ "Explore with Yuan" ──→ Yuan chat
   (quick)         (add context)     (contextual)       (deep thinking)
```

Each step adds more context and interaction depth. The user chooses how deep to go.

---

## Task Chat Integration (Planned)

### Current state

TaskDetailsModal has a "Chat" tab that renders `task.chat` as raw text. A text input appends to the string. No structure, no cards, no message history.

### What needs to change

1. **Replace `task.chat` raw string** with `db.messages.where('taskId')` query
2. **Render structured messages** — distinguish agent text, user text, and askUserFor cards
3. **Inline AskUserForCard** — when agent posts an ask-type message, render the card in the chat stream
4. **Keep the send input** — user can still free-text message the agent

### Data flow

```
Agent calls askUserFor(mode: 'choice', ...)
  → AskUserForHandler sends message to db.messages with type 'ask'
    → If task panel is open: renders AskUserForCard inline
    → Also appears in mailbox for async access
  → User answers (choice/text)
    → eventBus.emit('user:reply')
    → Agent continues
```

### Refactor steps

1. Change task chat tab to read from `db.messages` instead of `task.chat`
2. Add structured message rendering (agent bubble, user bubble, ask card)
3. Add AskUserForCard rendering for ask-type messages
4. Route askUserFor questions to task messages when task panel is active
5. Keep mail as fallback for async/non-active tasks

---

## Architectural Separation: Transport vs Persona

### The problem

Currently, *where* a chat happens is tangled with *who* is chatting and *what tools* they have. Yuan chat is a tab. Task chat is a modal panel. Mail is a sidebar. Each has its own rendering, its own message flow, its own personality assumptions.

This doesn't scale. Adding Telegram (or Slack, or Discord) means duplicating the entire stack for each new surface.

### The separation

Three independent concerns:

| Layer | Responsibility | Examples |
|-------|---------------|----------|
| **Transport** | Where the interaction happens. Message delivery and rendering. | Telegram bot, in-app card, xterm chat, mail panel, task panel |
| **Persona** | Who is having the conversation. System prompt, tone, behavior. | Explorer, Analyst, Worker, Task Agent, Orchestrator |
| **Tools/Data** | What context and capabilities are available. | Repo files, task logs, artifacts, bash, search |

### How they compose

```
Transport × Persona × Tools = an interaction
```

Examples:
- **Telegram + Explorer + read-only** → "Help me think through the architecture on my phone"
- **Task panel + Agent + full context** → "Agent asks about JWT vs session mid-task"
- **Mail + choice + none** → "Quick binary decision, no tools needed"
- **Yuan tab + Worker + bash** → "Hands-on coding session with the user"
- **xterm + Agent + bash** → "Agent chats directly in terminal"

### Implementation model

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Transport   │────▶│   Persona    │────▶│   Tools/Data    │
│              │     │              │     │                 │
│ - Telegram   │     │ - explorer   │     │ - repo files    │
│ - Mail card  │     │ - analyst    │     │ - task logs     │
│ - Task panel │     │ - worker     │     │ - bash executor │
│ - Yuan tab   │     │ - task-agent │     │ - artifacts     │
│ - xterm      │     │ - overseer   │     │ - web search    │
└─────────────┘     └──────────────┘     └─────────────────┘
       │                   │                     │
       ▼                   ▼                     ▼
  Message routing    System prompt         Capability set
  Render format      Tone/style            Context scope
  Input handling     Decision logic        Tool availability
```

### What this means for askUserFor

The `AskUserForHandler` currently decides the surface (mail vs Yuan) based on mode. Instead:

1. **Handler produces a question** (mode, prompt, options, persona hint, context level)
2. **Router decides the surface** — based on what's active, what the user prefers, what persona fits
3. **Transport renders it** — Telegram card, mail card, task chat card, Yuan chat — all from the same question data

### Telegram integration: Group + Topics model

Not a simple notification bot. A **Telegram supergroup with topic threads** that mirrors the in-app experience.

#### Group structure

```
📱 Agent Kanban (supergroup)
  │
  ├── 📬 Mailbox (topic)
  │     Every agent message lands here. Simple questions get inline
  │     keyboard buttons. User taps → reply goes back to agent.
  │
  ├── 📋 Tasks (topic)
  │     One topic per active task. Agent logs, questions, and context
  │     appear here. User can reply inline — same as task panel chat.
  │
  ├── 🧠 Yuan (topic)
  │     Spawned Yuan conversations get their own threads here.
  │     Explorer/analyst/worker persona carries over.
  │
  └── 🔔 Notifications (topic)
        Non-interactive: task completed, review needed, error alerts.
```

#### Message flow: Mail → Chat escalation (in Telegram)

This is the key interaction. A mail arrives, the user wants more than a quick answer:

```
1. Agent asks: "Which payment provider?"
   → Posted to 📬 Mailbox topic with inline buttons: [Stripe, Paddle, LemonSqueezy]

2a. User taps [Stripe]
   → Simple reply. Agent continues. Done.

2b. User replies with text instead: "not sure, let me think"
   → Bot recognizes this isn't a clean answer
   → Offers: "Start a Yuan chat about this?" [Yes, explore] [No, just use Stripe]

2c. User taps [Yes, explore]
   → Bot creates a new thread in 🧠 Yuan topic
   → Yuan (explorer persona) starts: "Let's figure this out. What matters most — pricing, DX, or geographic coverage?"
   → Full conversation happens in that thread
   → When resolved, summary posted back to original mailbox message
   → Agent gets the answer and continues
```

#### Message flow: Task question (in Telegram)

```
1. Agent hits contextual question mid-task
   → Posted to the task's thread in 📋 Tasks topic
   → Includes recent context: last 3 log lines, current file being edited
   → Inline buttons for choice mode, or text reply for open questions

2. User replies in thread
   → eventBus.emit('user:reply') → agent continues
   → All context already loaded in the task agent
```

#### Bidirectional sync

```
In-app mail ←→ Telegram Mailbox topic
In-app task chat ←→ Telegram task thread
In-app Yuan tab ←→ Telegram Yuan thread
```

Actions taken on either side sync to the other. User answers a mail in Telegram → it appears as resolved in the in-app mailbox. User opens a Yuan chat in-app → messages also post to Telegram Yuan thread.

#### Transport interface

```typescript
interface Transport {
  // Push a question to the user
  send(question: RoutedQuestion): Promise<void>;
  // Receive a response from the user
  onReply(handler: (response: UserResponse) => void): void;
  // Push a chat message (for Yuan/task chat)
  sendMessage(message: ChatMessage): Promise<void>;
  // Create a new conversation thread (for escalation)
  createThread(opts: ThreadOptions): Promise<string>;
  // Close/resolve a thread
  resolveThread(threadId: string, summary: string): Promise<void>;
}

interface ThreadOptions {
  parentMessageId?: string;  // for escalation chains
  topic: 'mailbox' | 'tasks' | 'yuan';
  persona?: string;
  objective?: string;
}
```

Implementations: `TelegramTransport`, `InAppMailTransport`, `TaskPanelTransport`, `YuanChatTransport`.

#### Why supergroup + topics, not individual bots

1. **Context continuity** — User sees all agent activity in one place, organized by topic. Not scattered across DMs.
2. **Escalation is natural** — Reply to a mail → thread spawns in Yuan topic. The group structure makes the transition visible.
3. **Team visibility** — Multiple team members can see and respond to agent questions. Not locked to one person's DM.
4. **History** — Telegram keeps the full history. Becomes an audit log of all agent-human interactions.
5. **Mobile-first** — The entire askUserFor system becomes usable from a phone. No need to open the web app for simple decisions.

---

## Summary

| Surface | User attention | Context | Best for |
|---------|---------------|---------|----------|
| Mail | Low (async) | None | Quick decisions |
| Yuan Chat | Medium (focused) | Strategic | Thinking through problems |
| Task Panel | High (active) | Full task | Context-heavy Q&A |
| Telegram | Any (push) | Varies | Mobile/async everything |

The key architectural move: **separate transport from persona from tools**. Then any question can surface anywhere, with the right personality and the right capabilities.
