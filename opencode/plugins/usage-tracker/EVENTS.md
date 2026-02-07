# OpenCode Event System - Comprehensive Reference

> **Last Updated**: 2026-02-06  
> **Source**: anomalyco/opencode repository (dev branch)

## Table of Contents

1. [Overview](#overview)
2. [Event Architecture](#event-architecture)
3. [Session Events](#session-events)
4. [Message Events](#message-events)
5. [Other Events](#other-events)
6. [Plugin Hooks](#plugin-hooks)
7. [Trigger Points Summary](#trigger-points-summary)

---

## Overview

OpenCode uses a centralized event bus system (`Bus`) for inter-module communication and plugin integration. Events are defined using `BusEvent.define()` with Zod schemas for type safety.

### Key Components

- **Bus**: Central event bus (`packages/opencode/src/bus/index.ts`)
- **BusEvent**: Event definition factory (`packages/opencode/src/bus/bus-event.ts`)
- **Plugin Integration**: Plugins receive all events via `event` handler

---

## Event Architecture

### Event Flow

```
OpenCode Module → Bus.publish(Event, data) → Plugin.event({ event })
```

### Event Structure

All events follow this structure:
```typescript
{
  type: string,      // Event type identifier (e.g., "session.created")
  properties: object // Event-specific data
}
```

### Plugin Event Handler

Plugins receive events through:
```typescript
export const MyPlugin: Plugin = async (input) => {
  return {
    event: async ({ event }: { event: Event }) => {
      switch (event.type) {
        case "session.created":
          // Handle session creation
          break
      }
    }
  }
}
```

---

## Session Events

### 1. `session.created`

**Summary**: Fired when a new session is created.

**Event Shape**:
```typescript
{
  type: "session.created",
  properties: {
    info: {
      id: string,                    // Session ID (e.g., "sess_abc123")
      slug: string,                  // URL-friendly identifier
      projectID: string,             // Associated project ID
      directory: string,             // Working directory
      parentID?: string,             // Parent session ID (for child sessions)
      title: string,                 // Session title
      version: string,               // OpenCode version
      time: {
        created: number,             // Timestamp (ms since epoch)
        updated: number,             // Last update timestamp
        compacting?: number,         // When compaction started
        archived?: number,           // When archived
      },
      summary?: {
        additions: number,           // Lines added
        deletions: number,           // Lines deleted
        files: number,               // Files changed
        diffs?: FileDiff[],          // File diff details
      },
      share?: {
        url: string,                 // Public share URL
      },
      permission?: Ruleset,          // Permission rules
      revert?: {
        messageID: string,
        partID?: string,
        snapshot?: string,
        diff?: string,
      },
    }
  }
}
```

**Trigger Points**:

1. **Location**: `packages/opencode/src/session/index.ts:303`
   - **Function**: `createNext()`
   - **Summary**: When a new session is created via `Session.create()`
   - **Example Data**:
     ```json
     {
       "info": {
         "id": "sess_20240206120000_abc123",
         "slug": "abc123def",
         "projectID": "proj_xyz789",
         "directory": "/Users/user/myproject",
         "title": "New session - 2024-02-06T12:00:00.000Z",
         "version": "1.0.0",
         "time": {
           "created": 1707216000000,
           "updated": 1707216000000
         }
       }
     }
     ```

---

### 2. `session.updated`

**Summary**: Fired when session metadata is updated.

**Event Shape**:
```typescript
{
  type: "session.updated",
  properties: {
    info: Session.Info  // Same shape as session.created
  }
}
```

**Trigger Points**:

1. **Location**: `packages/opencode/src/session/index.ts:316`
   - **Function**: `createNext()` (after creation)
   - **Summary**: Immediately after `session.created` is fired

2. **Location**: `packages/opencode/src/session/index.ts:411`
   - **Function**: `update()`
   - **Summary**: When session metadata is modified (title, share, etc.)
   - **Example Context**: Session title updated, sharing enabled

---

### 3. `session.deleted`

**Summary**: Fired when a session is deleted.

**Event Shape**:
```typescript
{
  type: "session.deleted",
  properties: {
    info: Session.Info  // Full session data before deletion
  }
}
```

**Trigger Points**:

1. **Location**: `packages/opencode/src/session/index.ts:454`
   - **Function**: `remove()`
   - **Summary**: When `Session.remove(sessionID)` is called
   - **Cascading**: Also deletes all child sessions, messages, and parts

---

### 4. `session.diff`

**Summary**: Fired when file changes are tracked in a session.

**Event Shape**:
```typescript
{
  type: "session.diff",
  properties: {
    sessionID: string,
    diff: FileDiff[]
  }
}
```

**Trigger Points**: Not actively searched in codebase - likely triggered during file operations.

---

### 5. `session.error`

**Summary**: Fired when a session encounters an error.

**Event Shape**:
```typescript
{
  type: "session.error",
  properties: {
    sessionID?: string,  // Optional - may be undefined for global errors
    error: {
      name: string,      // Error type (e.g., "ProviderAuthError", "APIError")
      message: string,   // Error message
      // Additional error-specific fields
    }
  }
}
```

**Trigger Points**:

1. **Location**: `packages/opencode/src/session/processor.ts:357`
   - **Function**: `SessionProcessor.process()` error handler
   - **Summary**: When message processing fails
   - **Example**: API errors, authentication failures, network issues

2. **Location**: `packages/opencode/src/plugin/index.ts:67`
   - **Function**: Plugin loading error handler
   - **Summary**: When a built-in plugin fails to install

---

### 6. `session.idle` (Deprecated)

**Summary**: Fired when a session becomes idle (processing complete).

**Event Shape**:
```typescript
{
  type: "session.idle",
  properties: {
    sessionID: string
  }
}
```

**Trigger Points**:

1. **Location**: `packages/opencode/src/session/status.ts:45`
   - **Function**: `SessionStatus.set()`
   - **Summary**: When status changes from "busy" to "idle"
   - **Note**: This event is deprecated; use `session.status` instead

---

### 7. `session.status`

**Summary**: Fired when session status changes.

**Event Shape**:
```typescript
{
  type: "session.status",
  properties: {
    sessionID: string,
    status: {
      type: "idle" | "busy" | "retry",
      // For "retry" status:
      attempt?: number,
      message?: string,
      next?: number,
    }
  }
}
```

**Trigger Points**:

1. **Location**: `packages/opencode/src/session/status.ts:38`
   - **Function**: `SessionStatus.set()`
   - **States**:
     - `busy`: Processing started
     - `idle`: Processing complete
     - `retry`: Retrying after error

2. **Location**: `packages/opencode/src/session/processor.ts:44`
   - **Summary**: Status set to "busy" at start of processing

3. **Location**: `packages/opencode/src/session/processor.ts:372`
   - **Summary**: Status set to "idle" at end of processing or on error

---

### 8. `session.compacted`

**Summary**: Fired when session context compaction is complete.

**Event Shape**:
```typescript
{
  type: "session.compacted",
  properties: {
    sessionID: string
  }
}
```

**Trigger Points**:

1. **Location**: `packages/opencode/src/session/compaction.ts:176`
   - **Function**: `SessionCompaction.process()`
   - **Summary**: After compaction assistant finishes summarizing context
   - **Note**: Only fired if compaction succeeds without errors

**Related Hook**: `experimental.session.compacting` (triggered before compaction starts)

---

## Message Events

### 1. `message.updated`

**Summary**: Fired when a message is created or updated.

**Event Shape**:
```typescript
{
  type: "message.updated",
  properties: {
    info: UserMessage | AssistantMessage
  }
}
```

**UserMessage Shape**:
```typescript
{
  id: string,
  sessionID: string,
  role: "user",
  time: { created: number },
  agent: string,              // Agent that received the message
  model: {
    providerID: string,
    modelID: string,
  },
  system?: string,            // System prompt used
  tools?: Record<string, boolean>,
  variant?: string,
  summary?: {
    title?: string,
    body?: string,
    diffs: FileDiff[],
  },
}
```

**AssistantMessage Shape**:
```typescript
{
  id: string,
  sessionID: string,
  role: "assistant",
  parentID: string,           // ID of user message being replied to
  modelID: string,
  providerID: string,
  mode: string,               // Agent mode (deprecated)
  agent: string,              // Agent that generated the response
  path: {
    cwd: string,
    root: string,
  },
  time: {
    created: number,
    completed?: number,
  },
  cost: number,               // Total cost in USD
  tokens: {
    input: number,
    output: number,
    reasoning: number,
    cache: { read: number, write: number },
  },
  finish?: string,            // Finish reason (e.g., "end_turn", "tool_calls")
  summary?: boolean,          // Whether this is a summary message
  error?: ErrorType,          // Error if generation failed
}
```

**Trigger Points**:

1. **Location**: `packages/opencode/src/session/index.ts:471`
   - **Function**: `updateMessage()`
   - **Summary**: Every time a message is written to storage
   - **Called From**:
     - `prompt.ts` - User message creation
     - `prompt.ts` - Assistant message creation (start)
     - `processor.ts` - Assistant message update (end with tokens/cost)
     - `compaction.ts` - Compaction messages
     - `plan.ts` - Plan approval messages

2. **Location**: `packages/opencode/src/session/processor.ts:281`
   - **Context**: After assistant message completes
   - **Data**: Full message with `time.completed`, final `cost`, `tokens`, `finish`

**⚠️ CRITICAL BEHAVIOR**: 
- Called TWICE for assistant messages (once at start, once at end)
- Final call overwrites message data with complete metrics

---

### 2. `message.removed`

**Summary**: Fired when a message is deleted (undo/redo).

**Event Shape**:
```typescript
{
  type: "message.removed",
  properties: {
    sessionID: string,
    messageID: string,
  }
}
```

**Trigger Points**:

1. **Location**: `packages/opencode/src/session/index.ts:489`
   - **Function**: `removeMessage()`
   - **Summary**: When a message is permanently deleted
   - **Context**: Undo operations, revert to checkpoint

2. **Location**: `packages/opencode/src/session/revert.ts:71`
   - **Function**: Revert to checkpoint
   - **Summary**: Removes messages after revert point

---

### 3. `message.part.updated`

**Summary**: Fired when a message part is created or updated.

**Event Shape**:
```typescript
{
  type: "message.part.updated",
  properties: {
    part: Part,
    delta?: string,  // Only for streaming text/reasoning parts
  }
}
```

**Part Types**:

- **TextPart**: Assistant text response
  ```typescript
  {
    type: "text",
    id: string,
    messageID: string,
    sessionID: string,
    text: string,
    synthetic?: boolean,  // Auto-generated (e.g., compaction prompts)
    ignored?: boolean,
    time?: { start?: number, end?: number },
    metadata?: Record<string, unknown>,
  }
  ```

- **ToolPart**: Tool execution
  ```typescript
  {
    type: "tool",
    id: string,
    messageID: string,
    sessionID: string,
    callID: string,
    tool: string,
    state: {
      status: "pending" | "running" | "completed" | "error",
      input: Record<string, unknown>,
      // For completed:
      output?: string,
      title?: string,
      metadata?: Record<string, unknown>,
      time: { start: number, end?: number, compacted?: number },
      attachments?: FilePart[],
      // For error:
      error?: string,
    },
  }
  ```

- **ReasoningPart**: Model reasoning (Claude only)
- **CompactionPart**: Session compaction marker
- **SubtaskPart**: Sub-agent task delegation
- **FilePart**: File attachments
- **StepStartPart/StepFinishPart**: Processing step markers

**Trigger Points**:

1. **Location**: `packages/opencode/src/session/index.ts:518`
   - **Function**: `updatePart()`
   - **Summary**: All part updates go through here

2. **Location**: `packages/opencode/src/session/processor.ts:58`
   - **Context**: Reasoning delta during streaming
   - **Example**: `part.text += value.text`, delta contains new text chunk

3. **Location**: `packages/opencode/src/session/processor.ts:83`
   - **Context**: Text delta during streaming
   - **Example**: `currentText.text += value.text`

4. **Location**: `packages/opencode/src/session/processor.ts:96`
   - **Context**: Tool execution state changes

5. **Location**: `packages/opencode/src/session/processor.ts:303`
   - **Context**: Text streaming complete

**⚠️ STREAMING BEHAVIOR**:
- Text parts fire MULTIPLE times with `delta` during streaming
- Final call has NO delta and complete `text`
- Tool parts fire when status changes (pending → running → completed/error)

---

### 4. `message.part.removed`

**Summary**: Fired when a message part is deleted (undo/redo).

**Event Shape**:
```typescript
{
  type: "message.part.removed",
  properties: {
    sessionID: string,
    messageID: string,
    partID: string,
  }
}
```

**Trigger Points**:

1. **Location**: `packages/opencode/src/session/index.ts:507`
   - **Function**: `removePart()`
   - **Summary**: Direct part removal

2. **Location**: `packages/opencode/src/session/revert.ts:105`
   - **Function**: Revert to checkpoint
   - **Summary**: Removes parts after revert point during undo

---

## Other Events

### Question Events

#### `question.asked`

**Event Shape**:
```typescript
{
  type: "question.asked",
  properties: {
    sessionID: string,
    requestID: string,
    questions: Question[],
  }
}
```

#### `question.replied`

**Event Shape**:
```typescript
{
  type: "question.replied",
  properties: {
    sessionID: string,
    requestID: string,
    answers: Answer[],
  }
}
```

#### `question.rejected`

**Event Shape**:
```typescript
{
  type: "question.rejected",
  properties: {
    sessionID: string,
    requestID: string,
  }
}
```

**Location**: `packages/opencode/src/question/index.ts`

---

### Permission Events

#### `permission.asked`

**Event Shape**:
```typescript
{
  type: "permission.asked",
  properties: {
    id: string,
    sessionID: string,
    tool: string,
    callID: string,
    metadata: Record<string, unknown>,
    description?: string,
    patterns: string[],
    projectID: string,
  }
}
```

#### `permission.replied`

**Event Shape**:
```typescript
{
  type: "permission.replied",
  properties: {
    sessionID: string,
    requestID: string,
    reply: {
      status: "allow" | "deny" | "always" | "never",
    },
  }
}
```

**Location**: `packages/opencode/src/permission/next.ts`

---

### Installation Events

#### `installation.updated`

**Event Shape**:
```typescript
{
  type: "installation.updated",
  properties: {
    version: string,
  }
}
```

#### `installation.update-available`

**Event Shape**:
```typescript
{
  type: "installation.update-available",
  properties: {
    version: string,
  }
}
```

**Location**: `packages/opencode/src/installation/index.ts`

---

### Server Events

#### `server.connected`

**Event Shape**:
```typescript
{
  type: "server.connected",
  properties: {}
}
```

#### `global.disposed`

**Event Shape**:
```typescript
{
  type: "global.disposed",
  properties: {}
}
```

**Location**: `packages/opencode/src/server/event.ts`

---

### PTY Events

- `pty.created`
- `pty.updated`
- `pty.exited`
- `pty.deleted`

**Location**: `packages/opencode/src/pty/index.ts`

---

### TUI Events (Internal)

- `tui.prompt.append`
- `tui.command.execute`
- `tui.toast.show`

**Location**: `packages/opencode/src/cli/cmd/tui/event.ts`

---

## Plugin Hooks

Hooks are different from events - they're triggered synchronously and can modify data.

### 1. `tool.execute.before`

**Summary**: Triggered before a tool executes.

**Input**:
```typescript
{
  tool: string,      // Tool name
  sessionID: string,
  callID: string,
}
```

**Output**:
```typescript
{
  args: unknown,     // Tool arguments (can be modified)
}
```

**Trigger Points**:

1. **Location**: `packages/opencode/src/session/prompt.ts:370`
   - **Context**: Task tool execution
   - **Tool**: "task"

**Location in Plugin**: `packages/plugin/src/tool.ts`

---

### 2. `tool.execute.after`

**Summary**: Triggered after a tool executes.

**Input**:
```typescript
{
  tool: string,
  sessionID: string,
  callID: string,
}
```

**Output**:
```typescript
{
  output: unknown,   // Tool output (can be modified)
}
```

**Trigger Points**:

1. **Location**: `packages/opencode/src/session/prompt.ts:412`
   - **Context**: After task tool completes

---

### 3. `experimental.session.compacting`

**Summary**: Triggered before session compaction starts. Allows plugins to inject context.

**Input**:
```typescript
{
  sessionID: string,
}
```

**Output**:
```typescript
{
  context: string[],     // Additional context to include
  prompt?: string,       // Optional custom prompt
}
```

**Trigger Points**:

1. **Location**: `packages/opencode/src/session/compaction.ts:131`
   - **Context**: Before compaction LLM call
   - **Default Prompt**: "Provide a detailed prompt for continuing our conversation above..."

---

### 4. `experimental.text.complete`

**Summary**: Triggered when text generation is complete. Allows plugins to transform final text.

**Input**:
```typescript
{
  sessionID: string,
  messageID: string,
  partID: string,
}
```

**Output**:
```typescript
{
  text: string,      // Final text (can be modified)
}
```

**Trigger Points**:

1. **Location**: `packages/opencode/src/session/processor.ts:303`
   - **Context**: After streaming text completes

---

### 5. `experimental.chat.system.transform`

**Summary**: Transform system prompts before LLM call.

**Input**:
```typescript
{
  sessionID?: string,
  model: Model,
}
```

**Output**:
```typescript
{
  system: string[],  // System prompts (can be modified)
}
```

**Trigger Points**:

1. **Location**: `packages/opencode/src/session/llm.ts:79`
   - **Context**: Before LLM streaming starts

2. **Location**: `packages/opencode/src/agent/agent.ts:281`
   - **Context**: Agent generation

---

### 6. `chat.params`

**Summary**: Transform LLM parameters before call.

**Input**:
```typescript
{
  sessionID: string,
}
```

**Output**:
```typescript
{
  // AI SDK parameters (temperature, maxTokens, etc.)
}
```

**Trigger Points**:

1. **Location**: `packages/opencode/src/session/llm.ts:113`
   - **Context**: Before LLM call

---

### 7. `permission.ask`

**Summary**: Intercept permission requests.

**Input**: Permission request info

**Output**:
```typescript
{
  status: "ask" | "allow" | "deny",
}
```

**Trigger Points**:

1. **Location**: `packages/opencode/src/permission/index.ts:129`
   - **Context**: When tool requires permission

---

## Trigger Points Summary

### Session Events

| Event | Location | Function | Context |
|-------|----------|----------|---------|
| session.created | session/index.ts:303 | createNext() | New session |
| session.updated | session/index.ts:316, 411 | createNext(), update() | Session changes |
| session.deleted | session/index.ts:454 | remove() | Session deletion |
| session.error | session/processor.ts:357 | process() error handler | Processing error |
| session.error | plugin/index.ts:67 | Plugin load error | Plugin failure |
| session.idle | session/status.ts:45 | set() | Status to idle |
| session.status | session/status.ts:38 | set() | Any status change |
| session.compacted | session/compaction.ts:176 | process() | Compaction done |

### Message Events

| Event | Location | Function | Context |
|-------|----------|----------|---------|
| message.updated | session/index.ts:471 | updateMessage() | Message write |
| message.removed | session/index.ts:489 | removeMessage() | Message deletion |
| message.removed | session/revert.ts:71 | Revert | Undo messages |
| message.part.updated | session/index.ts:518 | updatePart() | Part write |
| message.part.removed | session/index.ts:507 | removePart() | Part deletion |
| message.part.removed | session/revert.ts:105 | Revert | Undo parts |

### Processor Events (Streaming)

| Event | Location | Context |
|-------|----------|---------|
| message.part.updated | processor.ts:58 | Reasoning delta |
| message.part.updated | processor.ts:83 | Text delta |
| message.part.updated | processor.ts:96 | Tool state change |
| message.part.updated | processor.ts:303 | Text complete |
| message.updated | processor.ts:281 | Assistant complete |

### Compaction Events

| Event | Location | Context |
|-------|----------|---------|
| message.updated | compaction.ts:99 | Compaction assistant |
| message.part.updated | compaction.ts:172 | Continue prompt |
| session.compacted | compaction.ts:176 | Compaction done |
| experimental.session.compacting | compaction.ts:131 | Pre-compaction hook |

---

## Important Notes for Plugin Developers

### 1. Message Content Accumulation

**Problem**: Assistant messages fire `message.updated` twice:
1. At creation (content=null, no tokens)
2. At completion (content=null in message object, tokens set)

**Solution**: 
- Content is in `message.part.updated` events (TextPart)
- Final metrics are in second `message.updated`
- Use `message.part.updated` to accumulate content
- Use second `message.updated` for final token/cost data

### 2. Streaming Parts

Text and reasoning parts stream with deltas:
- Multiple `message.part.updated` with `delta` field
- Final call without `delta` has complete text

### 3. Tool Execution Flow

1. `tool.execute.before` hook fires
2. `message.part.updated` with status="pending"
3. `message.part.updated` with status="running"
4. Tool executes
5. `message.part.updated` with status="completed"/"error"
6. `tool.execute.after` hook fires

### 4. Compaction Handling

- `experimental.session.compacting` hook fires first
- Compaction assistant message created
- `session.compacted` fires when done
- Messages during compaction should be skipped or marked

### 5. Undo/Redo

- `message.removed` fires for undone messages
- `message.part.removed` fires for undone parts
- Revert removes multiple messages/parts at once

---

## Files Referenced

- `packages/opencode/src/session/index.ts` - Session management
- `packages/opencode/src/session/message-v2.ts` - Message types
- `packages/opencode/src/session/processor.ts` - Message processing/streaming
- `packages/opencode/src/session/compaction.ts` - Context compaction
- `packages/opencode/src/session/status.ts` - Session status
- `packages/opencode/src/session/revert.ts` - Undo/redo
- `packages/opencode/src/session/prompt.ts` - Prompt handling
- `packages/opencode/src/session/llm.ts` - LLM integration
- `packages/opencode/src/plugin/index.ts` - Plugin system
- `packages/opencode/src/question/index.ts` - Question system
- `packages/opencode/src/permission/next.ts` - Permission system
- `packages/opencode/src/bus/index.ts` - Event bus
- `packages/sdk/js/src/gen/types.gen.ts` - SDK types
