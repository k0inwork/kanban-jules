# Agent Communication & Chat System Design

## Overview
This document outlines the design for introducing a comprehensive, two-way communication system between the user (and the external Jules execution system) and the local AI agents. The current system primarily acts as a one-way notification system where agents drop messages into a generic "Mailbox" view.

This design transitions the "Mailbox" into a full "Chat/Mail" system that supports agent identities, direct messaging, global broadcasts, interactions with the Project Manager (Overseer) Agent, and proxying messages to/from external execution instances (Jules).

---

## 1. Data Model Changes (IndexedDB / Dexie)

To support threaded, two-way communication, the `AgentMessage` schema needs to be expanded, and a new `AgentProfile` concept should be introduced.

### `AgentMessage` Updates
The existing `AgentMessage` table in `db.ts` needs the following modifications:
```typescript
export interface AgentMessage {
  id?: number;

  // Existing fields
  sender: string;       // E.g., 'Agent-X', 'User', 'Jules', 'Overseer'
  taskId?: string;
  type: 'info' | 'proposal' | 'alert' | 'chat'; // Added 'chat'
  content: string;
  status: 'unread' | 'read' | 'archived';
  timestamp: number;

  // Proposed fields
  threadId?: string;    // Groups messages into conversations/agent boxes
  recipient: string;    // 'all' for broadcasts, specific agent ID/name, or 'User' / 'Jules'
  replyToId?: number;   // ID of the specific message being replied to
  metadata?: {
    isFromJules?: boolean; // Flag to easily identify external traffic
  };

  // Existing proposal logic
  proposedTask?: {
    title: string;
    description: string;
  };
}
```

### `AgentProfile` (New Concept, optional DB table or derived state)
Agents currently are largely ephemeral classes (`LocalAgent`, `ProcessAgent`). We need a way to assign them distinct names.
* We can infer active agents based on assigned Tasks (`taskId` -> Agent mapping).
* The **ProcessAgent** will have a reserved identity (e.g., `Overseer`).

---

## 2. Core Features & Functional Design

### 2.1 Agent Identity (`From` field)
When an agent sends a message, it will explicitly provide its designated name or role.
* Instead of generic system notifications, messages will look like emails/chats from specific entities:
  * **From:** `Agent Alpha (Task-123)`
  * **From:** `Overseer Agent`
  * **From:** `Jules Integration`

### 2.2 Global / Broadcast Messaging
The user can send a message with the recipient set to `all`.
* **UI Action:** A "New Message" button in the generic Mailbox view with a dropdown for recipient. Selecting "All Agents" broadcasts the message.
* **Agent Logic:** When `LocalAgent` or `ProcessAgent` cycles its logic, it queries `db.messages` for `status === 'unread'` and `recipient === 'all'`. The agents inject these broadcast messages into their context window (LLM prompt) to adjust their immediate behavior.

### 2.3 Direct Agent Chat ("Agent Box")
The user can open a dedicated chat thread with a specific agent.
* **UI Action:** Clicking on an agent's name in a task card or navigating to the Mailbox and selecting an agent from the sidebar opens their "Agent Box".
* **Interaction:** The user types a message. A new `AgentMessage` is created with `sender: 'User'` and `recipient: 'Agent-X'`.
* **Agent Logic:** The agent monitors for messages addressed directly to it. Upon receiving one, it can reply, creating a thread.

### 2.4 Overseer Agent Interaction (Dynamic Constitution)
The "Overseer Agent" (implemented by `ProcessAgent.ts`) governs the project phases and priorities via the `ProjectConfig.constitution`.
* **User Flow:** The user sends a direct message to `Overseer Agent`.
  * E.g., *"Change priority to focus on bug fixes for this phase."*
* **Overseer Logic:** The `ProcessAgent` reads the message. Its LLM prompt is instructed to parse user directives and output a modified Constitution.
* **Database Update:** The `ProcessAgent` updates the `ProjectConfig.constitution` in Dexie, either permanently or with a notation that it only applies to the current phase. It then replies to the user: *"I have updated the project rules as requested."*

### 2.5 External Message Forwarding (Jules Integration)
The system supports an external execution agent ("Jules").
* **Incoming from Jules:** When Jules sends a message to the Kanban system via `sendMessage`, a new `AgentMessage` is created.
  * `sender`: 'Jules'
  * `metadata.isFromJules`: true
* **Replying:** When a local agent or the User replies to a message that has `isFromJules: true`, the system intercepts the database insert.
  * Instead of just saving it to Dexie for internal routing, the Kanban server API acts as a proxy, forwarding the reply payload back out to the Jules execution system over the wire (e.g., via the MCP connection or webhook).

---

## 3. UI/UX Changes

### 3.1 Updated `MailboxView.tsx`
* **Sidebar / Navigation:** Add a sub-navigation panel to the Mailbox:
  * `Inbox (All)`
  * `Overseer`
  * `Agent Alpha (Task-123)`
  * `Agent Beta (Task-124)`
* **Chat Interface:** Transition the UI from a list of cards to a Chat-like interface (similar to iMessage or Slack).
  * Left-aligned bubbles for Agents/Jules.
  * Right-aligned bubbles for User.
* **Input Area:** At the bottom of the active view, add a text input area with a Send button. If viewing the general "Inbox", provide a target selector (`@agent` or `@all`).

### 3.2 Task Integration
* On `TaskCard.tsx` and `TaskDetailsModal.tsx`, add a "Chat with Agent" button that deep-links directly into the `MailboxView` pre-filtered for that specific agent.

---

## 4. Architectural & Logic Flow

1. **Message Dispatcher:** Create a lightweight `MessageRouter` in the frontend or `TaskRouter.ts` that listens to `db.messages` changes via Dexie hooks.
2. **Context Injection:** Modify `LocalAgent.ts` and `ProcessAgent.ts` to fetch `unread` messages addressed to them (or `all`) before calling `callLlm`. The prompt should be updated:
   > *"You have received the following messages: [Message]. Consider this in your next action. Reply to the user if necessary by invoking the `sendReply` tool."*
3. **Agent Tooling:** Expose a new tool to the LLMs: `send_chat_message({ recipient, content })`.
4. **Jules Bridge:** In `server.ts` (or wherever the MCP API is defined), intercept messages originating from Jules. When a reply is generated internally addressed to 'Jules', emit a network request back to the Jules process.
