# OpenCode Usage Tracker -- Database Guide for Webapp Development

This document describes the SQLite database powering the OpenCode usage tracking
system. It covers the data model, terminology, relationships between entities,
every metric's meaning, and recommended query patterns for building a dashboard
webapp.

**Database file**: `~/.local/share/opencode/usage.db` (overridable via
`OPENCODE_USAGE_DB` env var)

**Engine**: SQLite with WAL mode. The DB is written by a real-time OpenCode
plugin and can also be populated from historical JSON data via a standalone
migration script.

---

## Table of Contents

1. [Glossary of Terms](#1-glossary-of-terms)
2. [Entity Relationship Overview](#2-entity-relationship-overview)
3. [Table-by-Table Reference](#3-table-by-table-reference)
4. [Understanding the Message Loop](#4-understanding-the-message-loop)
5. [Token Metrics Explained](#5-token-metrics-explained)
6. [Cost Tracking](#6-cost-tracking)
7. [Special Flags and States](#7-special-flags-and-states)
8. [Blob Storage](#8-blob-storage)
9. [Query Patterns](#9-query-patterns)
10. [Data Quality Notes](#10-data-quality-notes)

---

## 1. Glossary of Terms

### Project
A git worktree (repository checkout) that the user has opened in OpenCode. Each
distinct worktree path gets its own project. The project ID is a hash derived
from the worktree path.

### Session
A single conversation between the user and the AI assistant. A session belongs
to exactly one project. Sessions are the primary unit of interaction -- the user
starts a session, exchanges messages, and optionally archives it when done.

### Subtask Session
When the AI uses a `Task` tool, OpenCode spawns a child session. This child
session has a `parent_id` pointing back to the parent session. The parent
session continues after the subtask completes. Subtasks can nest (a subtask can
spawn its own subtask). The `parent_id` column on `sessions` captures this tree
structure.

### User Message
A message sent by the user. This is the human's input -- a question, an
instruction, or a follow-up. Each user message can trigger one or more assistant
responses (see below).

### Assistant Message
A single response from the AI model. One user message can produce **multiple**
assistant messages. This happens because OpenCode's prompt loop creates a new
assistant message on each iteration when the model's finish reason is
`tool-calls` (the model wants to use tools, so the loop continues). Only the
**last** assistant message in a sequence will have a finish reason other than
`tool-calls` (typically `end-turn` or `stop`).

### Step
An individual LLM API call within an assistant message. One assistant message
contains **one or more** steps. The Vercel AI SDK's `maxSteps` parameter
controls this -- within a single assistant message, the SDK may call the LLM
multiple times if tool results need to be fed back. Each step has its own token
counts, cost, and finish reason. The sum of all step tokens equals the assistant
message's total tokens.

### Tool Call
A single invocation of a tool (e.g., `bash`, `read`, `edit`, `write`, `glob`,
`grep`, `task`) within a step. Tool calls have input, output, status, duration,
and an optional error. A step can contain zero or more tool calls. Tool calls
with status `completed` have both input and output blobs. Tool calls with status
`error` have input but may lack output.

### Compaction
When a session's context grows too long, OpenCode summarizes older messages and
replaces them with a compact summary. The user message that triggered compaction
is flagged with `compaction = 1`. Compacted tool call outputs are pruned and the
`compacted_at` timestamp is set on affected tool calls.

### Synthetic Message
A user message not typed by the human. These are system-generated messages
injected into the conversation -- compaction summaries, tool result wrappers, or
internal control messages. Flagged with `synthetic = 1`.

### Undo
When the user undoes a message (reverting the conversation), the user message is
soft-deleted by setting `undone_at` to a timestamp. The data is preserved but
should be excluded from most dashboard views.

### Summary (on assistant_messages)
A boolean flag. When `summary = 1`, this assistant message was generated as part
of a compaction/summarization step, not a regular user-facing response.

### Finish Reason
The reason the LLM stopped generating. Common values:
- `end-turn` / `stop` -- model finished naturally
- `tool-calls` -- model wants to call tools (loop will continue)
- `length` -- hit max token limit
- `cancel` -- user cancelled the response
- `error` -- an error occurred

### Agent
The agent type handling the conversation. Common values:
- `code` -- the main coding agent
- `task` -- a subtask agent spawned by the Task tool
- `title` -- a background agent that generates session titles

---

## 2. Entity Relationship Overview

```
projects
  |
  | 1:N
  v
sessions  (FK project_id -> projects.id)
  |  \
  |   `-- self-referential: parent_id -> sessions.id (subtask tree)
  |
  | 1:N
  v
user_messages  (FK session_id -> sessions.id)
  |
  | 1:N  (one user message can trigger multiple assistant responses)
  v
assistant_messages  (FK user_message_id -> user_messages.id)
  |        \
  |         `-- assistant_blobs  (1:N, stores text/reasoning content)
  |
  | 1:N  (one assistant message contains one or more LLM calls)
  v
steps  (FK assistant_message_id -> assistant_messages.id)
  |
  | 1:N  (one step can invoke zero or more tools)
  v
tool_calls  (FK step_id -> steps.id)
  |
  | 1:N  (input blob + output blob)
  v
tool_call_blobs  (FK tool_call_id -> tool_calls.id)
```

**Cascade deletes**: All child tables use `ON DELETE CASCADE`, so deleting a
session removes all its messages, steps, tool calls, and blobs.

**Exception**: `sessions.parent_id` uses `ON DELETE SET NULL` -- deleting a
parent session doesn't delete its subtask sessions, it just nulls out their
parent reference.

---

## 3. Table-by-Table Reference

### `projects`

| Column       | Type    | Description                                                |
|--------------|---------|------------------------------------------------------------|
| `id`         | TEXT PK | Hash derived from worktree path                            |
| `worktree`   | TEXT    | Absolute filesystem path of the git worktree               |
| `vcs`        | TEXT    | Version control system (currently always null)             |
| `created_at` | INTEGER | Unix epoch ms when the project was first seen              |

### `sessions`

| Column          | Type    | Description                                              |
|-----------------|---------|----------------------------------------------------------|
| `id`            | TEXT PK | UUID                                                     |
| `project_id`    | TEXT FK | References `projects.id`                                 |
| `parent_id`     | TEXT FK | Self-reference for subtask sessions. NULL for top-level  |
| `directory`     | TEXT    | Working directory path for this session                   |
| `title`         | TEXT    | Auto-generated title describing the conversation          |
| `version`       | TEXT    | OpenCode version string at time of session creation       |
| `additions`     | INTEGER | Total lines added across all files in this session        |
| `deletions`     | INTEGER | Total lines deleted across all files in this session      |
| `files_changed` | INTEGER | Number of files modified in this session                  |
| `created_at`    | INTEGER | Unix epoch ms                                            |
| `updated_at`    | INTEGER | Unix epoch ms (last activity)                            |
| `archived_at`   | INTEGER | Unix epoch ms when archived, NULL if active               |

**Notes**:
- `additions`, `deletions`, `files_changed` form the session's **diff summary**.
  These track the cumulative code changes made during the session.
- A session with `parent_id` is a subtask. To find the root session, walk
  `parent_id` until NULL.
- `archived_at` being set means the session is no longer active. It should still
  be included in historical analytics.

### `user_messages`

| Column             | Type    | Description                                              |
|--------------------|---------|----------------------------------------------------------|
| `id`               | TEXT PK | UUID                                                     |
| `session_id`       | TEXT FK | References `sessions.id`                                 |
| `content`          | TEXT    | The user's text input (may be NULL for placeholder rows) |
| `synthetic`        | INTEGER | 0 = real human input, 1 = system-generated               |
| `compaction`       | INTEGER | 0 = normal, 1 = this message triggered context compaction|
| `turn_duration_ms` | INTEGER | Wall-clock ms from user message to last assistant completion |
| `undone_at`        | INTEGER | Unix epoch ms when undone, NULL if active                 |
| `created_at`       | INTEGER | Unix epoch ms                                            |

**`turn_duration_ms`**: Measures the full "turn time" -- the wall-clock duration
from when the user sent their message (`created_at`) to when the **last**
associated assistant message finished (`MAX(assistant_messages.completed_at)`).
This spans the entire prompt loop, including all intermediate assistant messages
triggered by tool-calls. The value is materialized by the plugin when the final
assistant message completes (i.e. when `finish` is not `tool-calls`). For
migrated data, it is backfilled from `MAX(assistant_messages.completed_at) -
user_messages.created_at`. May be NULL if the turn is still in progress, was
cancelled before completion, or if timing data is unavailable.

**Filtering for real human input**:
```sql
WHERE synthetic = 0 AND compaction = 0 AND undone_at IS NULL
```

### `assistant_messages`

| Column               | Type    | Description                                       |
|----------------------|---------|---------------------------------------------------|
| `id`                 | TEXT PK | UUID                                              |
| `user_message_id`    | TEXT FK | References `user_messages.id`                     |
| `session_id`         | TEXT    | Denormalized from user_messages for query speed   |
| `agent`              | TEXT    | Agent type: `code`, `task`, `title`, etc.         |
| `provider_id`        | TEXT    | LLM provider: `github-copilot`, `anthropic`, etc. |
| `model_id`           | TEXT    | Model identifier: `claude-sonnet-4-20250514`, etc. |
| `summary`            | INTEGER | 1 = compaction summary message, 0 = normal        |
| `cost`               | REAL    | Total cost in USD for this entire response         |
| `tokens_in`          | INTEGER | Total input tokens (prompt) sent to the model      |
| `tokens_out`         | INTEGER | Total output tokens (completion) from the model    |
| `tokens_reasoning`   | INTEGER | Output tokens used for chain-of-thought reasoning  |
| `tokens_cache_read`  | INTEGER | Input tokens served from prompt cache              |
| `tokens_cache_write` | INTEGER | Input tokens written to prompt cache               |
| `finish`             | TEXT    | Finish reason for the overall response             |
| `error_type`         | TEXT    | Error class name if the response failed            |
| `error_message`      | TEXT    | Human-readable error message                       |
| `created_at`         | INTEGER | Unix epoch ms                                     |
| `completed_at`       | INTEGER | Unix epoch ms when the response finished           |

**Important**: `session_id` is denormalized here (it could be derived via
`user_messages.session_id`). This exists for query performance -- many queries
filter by session without needing to join through user_messages.

### `steps`

| Column                 | Type    | Description                                      |
|------------------------|---------|--------------------------------------------------|
| `id`                   | TEXT PK | Part ID of the `step-start` event                |
| `assistant_message_id` | TEXT FK | References `assistant_messages.id`                |
| `session_id`           | TEXT    | Denormalized for query speed                      |
| `cost`                 | REAL    | Cost for this individual LLM call                 |
| `tokens_in`            | INTEGER | Input tokens for this specific API call           |
| `tokens_out`           | INTEGER | Output tokens for this specific API call          |
| `tokens_reasoning`     | INTEGER | Reasoning tokens for this specific API call       |
| `tokens_cache_read`    | INTEGER | Cache-read tokens for this specific API call      |
| `tokens_cache_write`   | INTEGER | Cache-write tokens for this specific API call     |
| `finish_reason`        | TEXT    | Why this specific LLM call stopped                |
| `created_at`           | INTEGER | Unix epoch ms                                     |

**Key relationship**: The sum of all step token counts for an assistant message
should equal the assistant message's token counts. Steps give you per-API-call
granularity; assistant messages give you per-response totals.

### `tool_calls`

| Column         | Type    | Description                                          |
|----------------|---------|------------------------------------------------------|
| `id`           | TEXT PK | Part ID of the tool event                            |
| `step_id`      | TEXT FK | References `steps.id`                                |
| `session_id`   | TEXT    | Denormalized for query speed                          |
| `call_id`      | TEXT    | The LLM's generated tool call identifier              |
| `tool`         | TEXT    | Tool name: `bash`, `read`, `edit`, `write`, `glob`, `grep`, `task`, `webfetch`, etc. |
| `status`       | TEXT    | `completed` or `error`                                |
| `title`        | TEXT    | Human-readable description of what the tool did       |
| `error`        | TEXT    | Error message if status is `error`                    |
| `compacted_at` | INTEGER | Unix epoch ms when the output was pruned by compaction|
| `started_at`   | INTEGER | Unix epoch ms when execution started                  |
| `completed_at` | INTEGER | Unix epoch ms when execution finished                 |
| `duration_ms`  | INTEGER | `completed_at - started_at` (precomputed)             |

**Notes**:
- Only `completed` and `error` status tool calls are persisted. `pending` and
  `running` are transient states that aren't stored.
- `compacted_at` being set means the tool's output was pruned during context
  compaction. The tool_call_blob for `tool_output` may still contain the
  original output if it was captured before compaction.

### `assistant_blobs`

| Column                 | Type    | Description                                     |
|------------------------|---------|-------------------------------------------------|
| `id`                   | INTEGER | Auto-increment PK                               |
| `assistant_message_id` | TEXT FK | References `assistant_messages.id`               |
| `blob_type`            | TEXT    | `text` or `reasoning`                            |
| `content`              | TEXT    | The actual text content                          |
| `size_bytes`           | INTEGER | UTF-8 byte size of `content`                     |

**Blob types**:
- `text` -- The assistant's visible response text (what the user sees)
- `reasoning` -- Chain-of-thought / extended thinking content (hidden from user)

### `tool_call_blobs`

| Column         | Type    | Description                                          |
|----------------|---------|------------------------------------------------------|
| `id`           | INTEGER | Auto-increment PK                                    |
| `tool_call_id` | TEXT FK | References `tool_calls.id`                           |
| `blob_type`    | TEXT    | `tool_input` or `tool_output`                        |
| `content`      | TEXT    | The actual content (usually JSON for input, text for output) |
| `size_bytes`   | INTEGER | UTF-8 byte size of `content`                         |

**Blob types**:
- `tool_input` -- The arguments passed to the tool (JSON)
- `tool_output` -- The result returned by the tool (text or JSON)

### `migration_log`

| Column        | Type    | Description                                         |
|---------------|---------|-----------------------------------------------------|
| `file_path`   | TEXT PK | Relative path of the migrated JSON file             |
| `migrated_at` | INTEGER | Unix epoch ms when the file was processed           |

Internal bookkeeping table for the migration script. Not relevant for the
webapp.

---

## 4. Understanding the Message Loop

This is the most important section for building a correct dashboard. The
relationship between user messages, assistant messages, and steps is not 1:1.

### The Outer Loop: User Message -> N Assistant Messages

When the user sends a message, OpenCode enters a **prompt loop**:

1. Build the prompt with all conversation history
2. Call the LLM
3. If the model's finish reason is `tool-calls`, execute the tools, then go
   back to step 1 with a **new assistant message**
4. If the finish reason is `end-turn` / `stop`, the loop ends

Each iteration of this outer loop creates a **separate assistant_messages row**.
So a single user question like "refactor the auth module" might produce:

```
user_message: "refactor the auth module"
  |- assistant_message #1 (finish: "tool-calls")  -- reads files
  |- assistant_message #2 (finish: "tool-calls")  -- edits files
  |- assistant_message #3 (finish: "end-turn")    -- reports done
```

**To count "conversation turns"**, count user_messages (with `synthetic = 0 AND
undone_at IS NULL`). Do NOT count assistant_messages -- that would overcount.

### The Inner Loop: Assistant Message -> N Steps

Within a single assistant message, the Vercel AI SDK may invoke the LLM
multiple times (controlled by `maxSteps`). Each invocation is a **step**. This
typically happens when the model calls tools and the SDK automatically feeds the
tool results back for another LLM call within the same response.

```
assistant_message #1 (finish: "tool-calls")
  |- step #1 (finish_reason: "tool-calls") -- model says "read file X"
  |    |- tool_call: read("file X")
  |- step #2 (finish_reason: "tool-calls") -- model says "also read file Y"
  |    |- tool_call: read("file Y")
```

**For most analytics, you want assistant_message-level aggregation**, not
step-level. Steps are useful for detailed cost breakdowns and debugging.

### How to Compute Response Time

Each assistant message has `created_at` and `completed_at`. The difference is
the total wall-clock time for that response (including tool execution):

```sql
completed_at - created_at  -- total response time in ms
```

For tool-only duration, sum `duration_ms` from `tool_calls`.

---

## 5. Token Metrics Explained

### Token Types

| Metric              | What it measures                                           |
|---------------------|------------------------------------------------------------|
| `tokens_in`         | Total input tokens sent in the prompt (including system prompt, conversation history, and tool results) |
| `tokens_out`        | Total output tokens generated by the model (the response)  |
| `tokens_reasoning`  | Subset of `tokens_out` used for chain-of-thought reasoning (only for models with extended thinking like Claude) |
| `tokens_cache_read` | Subset of `tokens_in` that were served from the prompt cache instead of being reprocessed |
| `tokens_cache_write`| Subset of `tokens_in` that were written into the prompt cache for future reuse |

### Token Relationships

```
tokens_in = tokens_cache_read + tokens_cache_write + (uncached input tokens)
tokens_out >= tokens_reasoning  (reasoning is a subset of output)
```

The "uncached input tokens" aren't stored explicitly. Compute them as:
```
uncached_input = tokens_in - tokens_cache_read - tokens_cache_write
```

### Aggregation Levels

- **Step level**: Tokens for a single LLM API call. Most granular.
- **Assistant message level**: Sum of all steps in that response. This is what
  OpenCode displays in the UI and what you typically want for dashboards.
- **Session level**: `SUM()` across all assistant messages in the session.
- **Project level**: `SUM()` across all sessions in the project.

The step-level tokens should sum to the assistant-message-level tokens. If they
don't match exactly, prefer the assistant message values (they come from
OpenCode's final accounting after the response completes).

### Cache Hit Rate

Prompt caching significantly reduces cost. Calculate the hit rate as:

```sql
CASE WHEN tokens_in > 0
  THEN ROUND(100.0 * tokens_cache_read / tokens_in, 1)
  ELSE 0
END AS cache_hit_pct
```

A high cache hit rate (>80%) means most of the conversation history is being
reused efficiently between turns.

---

## 6. Cost Tracking

### Current State

The `cost` column exists on both `assistant_messages` and `steps`. It's a
floating-point value in USD.

**Important caveat**: If the provider is `github-copilot`, cost will always be
`0.0`. GitHub Copilot is a flat-rate subscription and doesn't report per-token
costs. If the user switches to a direct API provider (e.g., `anthropic`), costs
will be populated.

### Estimated Cost Calculation

For providers that don't report cost, you can estimate it from token counts
using known pricing. Example for Claude Sonnet:

```
estimated_cost =
  (tokens_in - tokens_cache_read) * input_price_per_token
  + tokens_cache_read * cache_read_price_per_token
  + tokens_cache_write * cache_write_price_per_token
  + tokens_out * output_price_per_token
```

Store pricing tables in the webapp, not in the database.

---

## 7. Special Flags and States

### user_messages.synthetic

| Value | Meaning |
|-------|---------|
| 0     | Real human input |
| 1     | System-generated (compaction summary, tool result wrapper, etc.) |

**Dashboard filtering**: Almost always filter to `synthetic = 0` when counting
user turns or showing conversation history.

### user_messages.compaction

| Value | Meaning |
|-------|---------|
| 0     | Normal message |
| 1     | This message triggered context compaction |

A compaction event means the conversation grew too large and OpenCode summarized
older messages. Messages with `compaction = 1` are always also `synthetic = 1`.

### user_messages.undone_at

NULL means active. A timestamp means the user reverted this message (and its
child assistant messages). Filter out undone messages for most views:

```sql
WHERE undone_at IS NULL
```

### assistant_messages.summary

| Value | Meaning |
|-------|---------|
| 0     | Normal response to user |
| 1     | Generated as part of compaction/summarization |

Filter out `summary = 1` messages from user-facing conversation views. Include
them in token/cost analytics (they still consume tokens).

### assistant_messages.finish

Common values and what they mean for the dashboard:

| Value        | Meaning                | Dashboard treatment |
|--------------|------------------------|---------------------|
| `end-turn`   | Completed normally     | Success |
| `stop`       | Completed (stop token) | Success |
| `tool-calls` | Needs more tool calls  | Intermediate (not final response) |
| `length`     | Hit token limit        | Warning |
| `cancel`     | User cancelled         | Cancelled |
| `error`      | Error occurred         | Error |

### tool_calls.status

| Value       | Meaning |
|-------------|---------|
| `completed` | Tool executed successfully |
| `error`     | Tool execution failed |

Only these two states are persisted. `pending` and `running` are transient.

### tool_calls.compacted_at

When set, the tool's output was pruned during context compaction. The original
output may still exist in `tool_call_blobs` if it was captured before compaction
occurred.

---

## 8. Blob Storage

Large text content is stored in separate blob tables rather than inline in the
main tables. This keeps the main tables lean for aggregation queries.

### When to Query Blobs

- **Conversation view**: Join `assistant_blobs` to get response text
- **Tool inspection**: Join `tool_call_blobs` to see tool input/output
- **Content search**: Full-text search across blobs
- **Size analytics**: Use `size_bytes` for data volume metrics

### When NOT to Query Blobs

- **Dashboard aggregation**: Never join blobs for summary/chart queries.
  Everything you need for counts, tokens, costs, and timing is in the main
  tables.
- **Session lists**: Only need `sessions` + aggregate from `assistant_messages`

---

## 9. Query Patterns

### 9.1 Session List with Summary Stats

List all sessions for a project with total tokens and turn count:

```sql
SELECT
  s.id,
  s.title,
  s.created_at,
  s.updated_at,
  s.additions,
  s.deletions,
  s.files_changed,
  s.archived_at,
  COUNT(DISTINCT um.id) FILTER (
    WHERE um.synthetic = 0 AND um.undone_at IS NULL
  ) AS turn_count,
  COALESCE(SUM(am.tokens_in), 0) AS total_tokens_in,
  COALESCE(SUM(am.tokens_out), 0) AS total_tokens_out,
  COALESCE(SUM(am.cost), 0) AS total_cost,
  COUNT(DISTINCT am.model_id) AS models_used
FROM sessions s
LEFT JOIN user_messages um ON um.session_id = s.id
LEFT JOIN assistant_messages am ON am.session_id = s.id
WHERE s.project_id = ?
  AND s.parent_id IS NULL  -- top-level sessions only
GROUP BY s.id
ORDER BY s.updated_at DESC
```

### 9.2 Session Detail -- Message Thread

Get the full conversation for a session:

```sql
SELECT
  um.id AS user_message_id,
  um.content AS user_content,
  um.synthetic,
  um.compaction,
  um.turn_duration_ms,
  um.undone_at,
  um.created_at AS user_created_at,
  am.id AS assistant_message_id,
  am.model_id,
  am.tokens_in,
  am.tokens_out,
  am.tokens_reasoning,
  am.cost,
  am.finish,
  am.error_type,
  am.error_message,
  am.created_at AS assistant_created_at,
  am.completed_at,
  ab.content AS assistant_text
FROM user_messages um
LEFT JOIN assistant_messages am ON am.user_message_id = um.id
LEFT JOIN assistant_blobs ab
  ON ab.assistant_message_id = am.id AND ab.blob_type = 'text'
WHERE um.session_id = ?
ORDER BY um.created_at, am.created_at
```

### 9.3 Daily Token Usage Over Time

```sql
SELECT
  DATE(am.created_at / 1000, 'unixepoch', 'localtime') AS day,
  SUM(am.tokens_in) AS total_in,
  SUM(am.tokens_out) AS total_out,
  SUM(am.tokens_reasoning) AS total_reasoning,
  SUM(am.cost) AS total_cost,
  COUNT(*) AS response_count
FROM assistant_messages am
WHERE am.created_at >= ?  -- start timestamp
  AND am.created_at <= ?  -- end timestamp
GROUP BY day
ORDER BY day
```

**Note**: `created_at` values are in **milliseconds** since Unix epoch. Divide
by 1000 for SQLite date functions which expect seconds.

### 9.4 Token Usage by Model

```sql
SELECT
  am.model_id,
  am.provider_id,
  COUNT(*) AS response_count,
  SUM(am.tokens_in) AS total_in,
  SUM(am.tokens_out) AS total_out,
  SUM(am.tokens_reasoning) AS total_reasoning,
  SUM(am.cost) AS total_cost,
  ROUND(AVG(am.tokens_in), 0) AS avg_in,
  ROUND(AVG(am.tokens_out), 0) AS avg_out,
  CASE WHEN SUM(am.tokens_in) > 0
    THEN ROUND(100.0 * SUM(am.tokens_cache_read) / SUM(am.tokens_in), 1)
    ELSE 0
  END AS cache_hit_pct
FROM assistant_messages am
WHERE am.model_id IS NOT NULL
GROUP BY am.model_id, am.provider_id
ORDER BY total_out DESC
```

### 9.5 Tool Usage Analytics

```sql
SELECT
  tc.tool,
  COUNT(*) AS call_count,
  SUM(CASE WHEN tc.status = 'error' THEN 1 ELSE 0 END) AS error_count,
  ROUND(100.0 * SUM(CASE WHEN tc.status = 'error' THEN 1 ELSE 0 END) / COUNT(*), 1) AS error_rate,
  ROUND(AVG(tc.duration_ms), 0) AS avg_duration_ms,
  MAX(tc.duration_ms) AS max_duration_ms,
  SUM(COALESCE(tcb_in.size_bytes, 0)) AS total_input_bytes,
  SUM(COALESCE(tcb_out.size_bytes, 0)) AS total_output_bytes
FROM tool_calls tc
LEFT JOIN tool_call_blobs tcb_in
  ON tcb_in.tool_call_id = tc.id AND tcb_in.blob_type = 'tool_input'
LEFT JOIN tool_call_blobs tcb_out
  ON tcb_out.tool_call_id = tc.id AND tcb_out.blob_type = 'tool_output'
GROUP BY tc.tool
ORDER BY call_count DESC
```

### 9.6 Subtask Tree for a Session

Get the subtask hierarchy for a root session:

```sql
WITH RECURSIVE subtree AS (
  SELECT id, parent_id, title, 0 AS depth
  FROM sessions
  WHERE id = ?  -- root session ID

  UNION ALL

  SELECT s.id, s.parent_id, s.title, st.depth + 1
  FROM sessions s
  JOIN subtree st ON s.parent_id = st.id
)
SELECT * FROM subtree ORDER BY depth, id
```

### 9.7 Error Rate Over Time

```sql
SELECT
  DATE(am.created_at / 1000, 'unixepoch', 'localtime') AS day,
  COUNT(*) AS total_responses,
  SUM(CASE WHEN am.error_type IS NOT NULL THEN 1 ELSE 0 END) AS errors,
  ROUND(100.0 * SUM(CASE WHEN am.error_type IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 1) AS error_rate
FROM assistant_messages am
GROUP BY day
ORDER BY day
```

### 9.8 Average Response Time per Session

```sql
SELECT
  am.session_id,
  s.title,
  COUNT(*) AS response_count,
  ROUND(AVG(am.completed_at - am.created_at), 0) AS avg_response_ms,
  MAX(am.completed_at - am.created_at) AS max_response_ms
FROM assistant_messages am
JOIN sessions s ON s.id = am.session_id
WHERE am.completed_at IS NOT NULL
  AND am.finish != 'tool-calls'  -- only final responses
GROUP BY am.session_id
ORDER BY avg_response_ms DESC
```

### 9.9 Turn Time Analytics

Turn time measures the full wall-clock duration from the user sending a message
to the last assistant message completing (spanning the entire tool-calls loop).
It is pre-computed and stored in `user_messages.turn_duration_ms`.

**Average turn time per session**:

```sql
SELECT
  um.session_id,
  s.title,
  COUNT(*) AS turn_count,
  ROUND(AVG(um.turn_duration_ms) / 1000.0, 1) AS avg_turn_secs,
  ROUND(MAX(um.turn_duration_ms) / 1000.0, 1) AS max_turn_secs,
  ROUND(MIN(um.turn_duration_ms) / 1000.0, 1) AS min_turn_secs
FROM user_messages um
JOIN sessions s ON s.id = um.session_id
WHERE um.turn_duration_ms IS NOT NULL
  AND um.synthetic = 0
  AND um.undone_at IS NULL
GROUP BY um.session_id
ORDER BY avg_turn_secs DESC
```

**Turn time distribution (histogram buckets)**:

```sql
SELECT
  CASE
    WHEN turn_duration_ms < 5000 THEN '< 5s'
    WHEN turn_duration_ms < 15000 THEN '5-15s'
    WHEN turn_duration_ms < 30000 THEN '15-30s'
    WHEN turn_duration_ms < 60000 THEN '30-60s'
    WHEN turn_duration_ms < 120000 THEN '1-2 min'
    WHEN turn_duration_ms < 300000 THEN '2-5 min'
    ELSE '5+ min'
  END AS bucket,
  COUNT(*) AS turn_count
FROM user_messages
WHERE turn_duration_ms IS NOT NULL
  AND synthetic = 0
  AND undone_at IS NULL
GROUP BY bucket
ORDER BY MIN(turn_duration_ms)
```

**Daily average turn time trend**:

```sql
SELECT
  DATE(um.created_at / 1000, 'unixepoch', 'localtime') AS day,
  COUNT(*) AS turns,
  ROUND(AVG(um.turn_duration_ms) / 1000.0, 1) AS avg_turn_secs,
  ROUND(CAST(SUM(um.turn_duration_ms) AS REAL) / 60000.0, 1) AS total_turn_mins
FROM user_messages um
WHERE um.turn_duration_ms IS NOT NULL
  AND um.synthetic = 0
  AND um.undone_at IS NULL
GROUP BY day
ORDER BY day
```

### 9.10 Steps per Assistant Message Distribution

Useful for understanding how many LLM roundtrips each response takes:

```sql
SELECT
  step_count,
  COUNT(*) AS message_count
FROM (
  SELECT
    am.id,
    COUNT(st.id) AS step_count
  FROM assistant_messages am
  LEFT JOIN steps st ON st.assistant_message_id = am.id
  GROUP BY am.id
) sub
GROUP BY step_count
ORDER BY step_count
```

### 9.11 Cache Efficiency Trend

```sql
SELECT
  DATE(am.created_at / 1000, 'unixepoch', 'localtime') AS day,
  SUM(am.tokens_cache_read) AS cached_tokens,
  SUM(am.tokens_in) AS total_input_tokens,
  CASE WHEN SUM(am.tokens_in) > 0
    THEN ROUND(100.0 * SUM(am.tokens_cache_read) / SUM(am.tokens_in), 1)
    ELSE 0
  END AS cache_hit_pct
FROM assistant_messages am
GROUP BY day
ORDER BY day
```

### 9.12 Global Summary Stats

A single query for a dashboard header:

```sql
SELECT
  (SELECT COUNT(*) FROM projects) AS total_projects,
  (SELECT COUNT(*) FROM sessions WHERE parent_id IS NULL) AS total_sessions,
  (SELECT COUNT(*) FROM user_messages
    WHERE synthetic = 0 AND undone_at IS NULL) AS total_turns,
  (SELECT COALESCE(SUM(tokens_in), 0) FROM assistant_messages) AS total_tokens_in,
  (SELECT COALESCE(SUM(tokens_out), 0) FROM assistant_messages) AS total_tokens_out,
  (SELECT COALESCE(SUM(cost), 0) FROM assistant_messages) AS total_cost,
  (SELECT COUNT(*) FROM tool_calls) AS total_tool_calls,
  (SELECT COUNT(DISTINCT model_id) FROM assistant_messages
    WHERE model_id IS NOT NULL) AS models_used,
  (SELECT ROUND(AVG(turn_duration_ms) / 1000.0, 1) FROM user_messages
    WHERE turn_duration_ms IS NOT NULL AND synthetic = 0 AND undone_at IS NULL) AS avg_turn_secs
```

### 9.13 Filtering Patterns

**Active messages only** (exclude undone):
```sql
WHERE um.undone_at IS NULL
```

**Real user turns only** (exclude synthetic/compaction):
```sql
WHERE um.synthetic = 0 AND um.compaction = 0 AND um.undone_at IS NULL
```

**Final responses only** (exclude intermediate tool-calls loop):
```sql
WHERE am.finish != 'tool-calls' OR am.finish IS NULL
```

**Top-level sessions only** (exclude subtasks):
```sql
WHERE s.parent_id IS NULL
```

**Active sessions only** (exclude archived):
```sql
WHERE s.archived_at IS NULL
```

**Date range** (timestamps are in milliseconds):
```sql
WHERE am.created_at >= :start_ms AND am.created_at < :end_ms
```

---

## 10. Data Quality Notes

### Placeholder Rows

The plugin uses defensive "ensure" inserts to handle events arriving
out-of-order. This means you may encounter:

- **Projects with `id = '_unknown'`**: Placeholder created when a session event
  arrives before its project event. Should be overwritten when the real project
  event arrives. Safe to filter out: `WHERE id != '_unknown'`.

- **User messages with `content = NULL`**: Placeholder created before the text
  part arrives, or the content was never captured (historical data). Still
  counts as a conversation turn.

- **Assistant messages with all-zero tokens**: Placeholder or data from
  before the response completed. Check `completed_at IS NOT NULL` to confirm
  the response actually finished.

### Migrated vs. Live Data

Data comes from two sources:
1. **Live plugin**: Captures events in real-time as you use OpenCode. Most
   accurate and complete.
2. **Migration script**: Backfills from historical JSON storage files. May have
   gaps -- e.g., if a session was in-progress when OpenCode was killed, the JSON
   files may be incomplete.

### Timestamps

All timestamps are **Unix epoch in milliseconds** (not seconds). When using
SQLite date functions, divide by 1000:

```sql
DATE(created_at / 1000, 'unixepoch', 'localtime')
DATETIME(created_at / 1000, 'unixepoch', 'localtime')
```

### Cost = 0 for GitHub Copilot

If `provider_id = 'github-copilot'`, `cost` will always be 0. The webapp should
detect this and either:
- Show estimated costs based on token counts and model pricing
- Display "N/A" or "included in subscription"

### Indexes

The following indexes exist for query performance:

| Index | Columns | Use Case |
|-------|---------|----------|
| `idx_sessions_project` | `(project_id, updated_at DESC)` | Session list by project |
| `idx_user_messages_session` | `(session_id, created_at)` | Messages in a session |
| `idx_assistant_messages_user` | `(user_message_id)` | Assistant msgs for a user msg |
| `idx_assistant_messages_session` | `(session_id, created_at)` | Assistant msgs in a session |
| `idx_assistant_messages_model` | `(model_id, created_at)` | Usage by model |
| `idx_steps_assistant` | `(assistant_message_id)` | Steps for an assistant msg |
| `idx_tool_calls_step` | `(step_id)` | Tool calls in a step |
| `idx_tool_calls_tool` | `(tool, started_at)` | Tool usage analytics |
| `idx_assistant_blobs_msg` | `(assistant_message_id)` | Blob lookup by message |
| `idx_tool_call_blobs_tc` | `(tool_call_id)` | Blob lookup by tool call |

These cover the query patterns above. If you add new query patterns, consider
whether additional indexes are needed. Be conservative -- each index slows down
writes.
