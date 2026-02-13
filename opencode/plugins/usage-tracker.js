import { tool } from "@opencode-ai/plugin"
import { Database } from "bun:sqlite"
import { join } from "node:path"
import { homedir } from "node:os"
import { readdirSync, readFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs"

// ---------------------------------------------------------------------------
// 1. Constants & DB path
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = 5

function getDbPath() {
  if (process.env.OPENCODE_USAGE_DB) return process.env.OPENCODE_USAGE_DB
  const dataDir = join(
    process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"),
    "opencode",
  )
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
  return join(dataDir, "usage.db")
}

// ---------------------------------------------------------------------------
// 2. Database initialization
// ---------------------------------------------------------------------------

function initDb() {
  const dbPath = getDbPath()

  // Schema version check — if outdated or corrupted, delete and recreate.
  // Open read-write (not readonly) so WAL is properly replayed before reading.
  if (existsSync(dbPath)) {
    let needsRecreate = false
    try {
      const tmp = new Database(dbPath)
      const row = tmp.query("PRAGMA user_version").get()
      const currentVersion = row?.user_version ?? 0
      tmp.close()
      if (currentVersion !== SCHEMA_VERSION) {
        needsRecreate = true
      }
    } catch {
      needsRecreate = true
    }
    if (needsRecreate) {
      try { unlinkSync(dbPath) } catch {}
      try { unlinkSync(dbPath + "-wal") } catch {}
      try { unlinkSync(dbPath + "-shm") } catch {}
    }
  }

  const db = new Database(dbPath)
  db.run("PRAGMA journal_mode = WAL")
  db.run("PRAGMA foreign_keys = ON")
  db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`)

  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id          TEXT PRIMARY KEY,
      worktree    TEXT,
      vcs         TEXT,
      created_at  INTEGER,
      updated_at  INTEGER
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id            TEXT PRIMARY KEY,
      project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      parent_id     TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      directory     TEXT NOT NULL,
      title         TEXT NOT NULL,
      version       TEXT,
      additions     INTEGER DEFAULT 0,
      deletions     INTEGER DEFAULT 0,
      files_changed INTEGER DEFAULT 0,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL,
      archived_at   INTEGER
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS user_messages (
      id                TEXT PRIMARY KEY,
      session_id        TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      content           TEXT,
      synthetic         INTEGER DEFAULT 0,
      compaction        INTEGER DEFAULT 0,
      turn_duration_ms  INTEGER,
      undone_at         INTEGER,
      created_at        INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS assistant_messages (
      id                  TEXT PRIMARY KEY,
      user_message_id     TEXT NOT NULL REFERENCES user_messages(id) ON DELETE CASCADE,
      session_id          TEXT NOT NULL,
      agent               TEXT,
      provider_id         TEXT,
      model_id            TEXT,
      summary             INTEGER DEFAULT 0,
      cost                REAL    DEFAULT 0,
      tokens_in           INTEGER DEFAULT 0,
      tokens_out          INTEGER DEFAULT 0,
      tokens_reasoning    INTEGER DEFAULT 0,
      tokens_cache_read   INTEGER DEFAULT 0,
      tokens_cache_write  INTEGER DEFAULT 0,
      finish              TEXT,
      error_type          TEXT,
      error_message       TEXT,
      created_at          INTEGER NOT NULL,
      completed_at        INTEGER,
      updated_at          INTEGER NOT NULL
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS steps (
      id                    TEXT PRIMARY KEY,
      assistant_message_id  TEXT NOT NULL REFERENCES assistant_messages(id) ON DELETE CASCADE,
      session_id            TEXT NOT NULL,
      cost                  REAL    DEFAULT 0,
      tokens_in             INTEGER DEFAULT 0,
      tokens_out            INTEGER DEFAULT 0,
      tokens_reasoning      INTEGER DEFAULT 0,
      tokens_cache_read     INTEGER DEFAULT 0,
      tokens_cache_write    INTEGER DEFAULT 0,
      finish_reason         TEXT,
      created_at            INTEGER,
      updated_at            INTEGER
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS tool_calls (
      id            TEXT PRIMARY KEY,
      step_id       TEXT NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
      session_id    TEXT NOT NULL,
      call_id       TEXT NOT NULL,
      tool          TEXT NOT NULL,
      status        TEXT NOT NULL,
      title         TEXT,
      error         TEXT,
      compacted_at  INTEGER,
      started_at    INTEGER,
      completed_at  INTEGER,
      duration_ms   INTEGER,
      updated_at    INTEGER
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS assistant_blobs (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      assistant_message_id  TEXT NOT NULL REFERENCES assistant_messages(id) ON DELETE CASCADE,
      blob_type             TEXT NOT NULL,
      content               TEXT NOT NULL,
      size_bytes            INTEGER NOT NULL
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS tool_call_blobs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      tool_call_id  TEXT NOT NULL REFERENCES tool_calls(id) ON DELETE CASCADE,
      blob_type     TEXT NOT NULL,
      content       TEXT NOT NULL,
      size_bytes    INTEGER NOT NULL
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS migration_log (
      file_path   TEXT PRIMARY KEY,
      migrated_at INTEGER NOT NULL
    )
  `)

  // Indexes
  db.run("CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id, updated_at DESC)")
  db.run("CREATE INDEX IF NOT EXISTS idx_user_messages_session ON user_messages(session_id, created_at)")
  db.run("CREATE INDEX IF NOT EXISTS idx_assistant_messages_user ON assistant_messages(user_message_id)")
  db.run("CREATE INDEX IF NOT EXISTS idx_assistant_messages_session ON assistant_messages(session_id, created_at)")
  db.run("CREATE INDEX IF NOT EXISTS idx_assistant_messages_model ON assistant_messages(model_id, created_at)")
  db.run("CREATE INDEX IF NOT EXISTS idx_steps_assistant ON steps(assistant_message_id)")
  db.run("CREATE INDEX IF NOT EXISTS idx_tool_calls_step ON tool_calls(step_id)")
  db.run("CREATE INDEX IF NOT EXISTS idx_tool_calls_tool ON tool_calls(tool, started_at)")
  db.run("CREATE INDEX IF NOT EXISTS idx_assistant_blobs_msg ON assistant_blobs(assistant_message_id)")
  db.run("CREATE INDEX IF NOT EXISTS idx_tool_call_blobs_tc ON tool_call_blobs(tool_call_id)")

  // Sync indexes — used by the external sync-to-turso cron job
  db.run("CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at)")
  db.run("CREATE INDEX IF NOT EXISTS idx_user_messages_updated ON user_messages(updated_at)")
  db.run("CREATE INDEX IF NOT EXISTS idx_assistant_messages_updated ON assistant_messages(updated_at)")
  db.run("CREATE INDEX IF NOT EXISTS idx_steps_updated ON steps(updated_at)")
  db.run("CREATE INDEX IF NOT EXISTS idx_tool_calls_updated ON tool_calls(updated_at)")
  db.run("CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at)")

  return db
}

// ---------------------------------------------------------------------------
// 3. Prepared statements
// ---------------------------------------------------------------------------

function prepareStatements(db) {
  return {
    upsertProject: db.query(`
      INSERT INTO projects (id, worktree, vcs, created_at, updated_at)
      VALUES ($id, $worktree, $vcs, $created_at, $updated_at)
      ON CONFLICT(id) DO UPDATE SET
        worktree = excluded.worktree,
        vcs = excluded.vcs,
        updated_at = excluded.updated_at
    `),

    upsertSession: db.query(`
      INSERT INTO sessions (id, project_id, parent_id, directory, title, version,
        additions, deletions, files_changed, created_at, updated_at, archived_at)
      VALUES ($id, $project_id, $parent_id, $directory, $title, $version,
        $additions, $deletions, $files_changed, $created_at, $updated_at, $archived_at)
      ON CONFLICT(id) DO UPDATE SET
        project_id = excluded.project_id,
        parent_id = COALESCE(excluded.parent_id, sessions.parent_id),
        directory = excluded.directory,
        title = excluded.title,
        version = excluded.version,
        additions = excluded.additions,
        deletions = excluded.deletions,
        files_changed = excluded.files_changed,
        updated_at = excluded.updated_at,
        archived_at = excluded.archived_at
    `),

    upsertUserMessage: db.query(`
      INSERT INTO user_messages (id, session_id, content, synthetic, compaction, turn_duration_ms, undone_at, created_at, updated_at)
      VALUES ($id, $session_id, $content, $synthetic, $compaction, $turn_duration_ms, $undone_at, $created_at, $updated_at)
      ON CONFLICT(id) DO UPDATE SET
        content = COALESCE(excluded.content, user_messages.content),
        synthetic = MAX(user_messages.synthetic, excluded.synthetic),
        compaction = MAX(user_messages.compaction, excluded.compaction),
        turn_duration_ms = COALESCE(excluded.turn_duration_ms, user_messages.turn_duration_ms),
        undone_at = COALESCE(excluded.undone_at, user_messages.undone_at),
        updated_at = excluded.updated_at
    `),

    markUserMessageUndone: db.query(
      "UPDATE user_messages SET undone_at = $undone_at, updated_at = $updated_at WHERE id = $id"
    ),

    markUserMessageCompaction: db.query(
      "UPDATE user_messages SET compaction = 1, synthetic = 1, updated_at = $updated_at WHERE id = $id"
    ),

    markUserMessageSynthetic: db.query(
      "UPDATE user_messages SET synthetic = 1, updated_at = $updated_at WHERE id = $id"
    ),

    updateTurnDuration: db.query(
      "UPDATE user_messages SET turn_duration_ms = $turn_duration_ms, updated_at = $updated_at WHERE id = $id"
    ),

    getUserMessageCreatedAt: db.query(
      "SELECT created_at FROM user_messages WHERE id = $id LIMIT 1"
    ),

    upsertAssistantMessage: db.query(`
      INSERT INTO assistant_messages (id, user_message_id, session_id, agent, provider_id, model_id,
        summary, cost, tokens_in, tokens_out, tokens_reasoning, tokens_cache_read, tokens_cache_write,
        finish, error_type, error_message, created_at, completed_at, updated_at)
      VALUES ($id, $user_message_id, $session_id, $agent, $provider_id, $model_id,
        $summary, $cost, $tokens_in, $tokens_out, $tokens_reasoning, $tokens_cache_read, $tokens_cache_write,
        $finish, $error_type, $error_message, $created_at, $completed_at, $updated_at)
      ON CONFLICT(id) DO UPDATE SET
        agent = excluded.agent,
        provider_id = excluded.provider_id,
        model_id = excluded.model_id,
        summary = MAX(assistant_messages.summary, excluded.summary),
        cost = excluded.cost,
        tokens_in = excluded.tokens_in,
        tokens_out = excluded.tokens_out,
        tokens_reasoning = excluded.tokens_reasoning,
        tokens_cache_read = excluded.tokens_cache_read,
        tokens_cache_write = excluded.tokens_cache_write,
        finish = excluded.finish,
        error_type = excluded.error_type,
        error_message = excluded.error_message,
        completed_at = excluded.completed_at,
        updated_at = excluded.updated_at
    `),

    upsertStep: db.query(`
      INSERT INTO steps (id, assistant_message_id, session_id, cost,
        tokens_in, tokens_out, tokens_reasoning, tokens_cache_read, tokens_cache_write,
        finish_reason, created_at, updated_at)
      VALUES ($id, $assistant_message_id, $session_id, $cost,
        $tokens_in, $tokens_out, $tokens_reasoning, $tokens_cache_read, $tokens_cache_write,
        $finish_reason, $created_at, $updated_at)
      ON CONFLICT(id) DO UPDATE SET
        cost = excluded.cost,
        tokens_in = excluded.tokens_in,
        tokens_out = excluded.tokens_out,
        tokens_reasoning = excluded.tokens_reasoning,
        tokens_cache_read = excluded.tokens_cache_read,
        tokens_cache_write = excluded.tokens_cache_write,
        finish_reason = excluded.finish_reason,
        updated_at = excluded.updated_at
    `),

    upsertToolCall: db.query(`
      INSERT INTO tool_calls (id, step_id, session_id, call_id, tool, status,
        title, error, compacted_at, started_at, completed_at, duration_ms, updated_at)
      VALUES ($id, $step_id, $session_id, $call_id, $tool, $status,
        $title, $error, $compacted_at, $started_at, $completed_at, $duration_ms, $updated_at)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        title = excluded.title,
        error = excluded.error,
        compacted_at = COALESCE(excluded.compacted_at, tool_calls.compacted_at),
        started_at = COALESCE(excluded.started_at, tool_calls.started_at),
        completed_at = COALESCE(excluded.completed_at, tool_calls.completed_at),
        duration_ms = excluded.duration_ms,
        updated_at = excluded.updated_at
    `),

    setToolCallCompacted: db.query(
      "UPDATE tool_calls SET compacted_at = $compacted_at, updated_at = $updated_at WHERE id = $id"
    ),

    insertAssistantBlob: db.query(`
      INSERT INTO assistant_blobs (assistant_message_id, blob_type, content, size_bytes)
      VALUES ($assistant_message_id, $blob_type, $content, $size_bytes)
    `),

    hasAssistantBlob: db.query(
      "SELECT 1 FROM assistant_blobs WHERE assistant_message_id = $assistant_message_id AND blob_type = $blob_type LIMIT 1"
    ),

    insertToolCallBlob: db.query(`
      INSERT INTO tool_call_blobs (tool_call_id, blob_type, content, size_bytes)
      VALUES ($tool_call_id, $blob_type, $content, $size_bytes)
    `),

    hasToolCallBlob: db.query(
      "SELECT 1 FROM tool_call_blobs WHERE tool_call_id = $tool_call_id AND blob_type = $blob_type LIMIT 1"
    ),

    isMigrated: db.query(
      "SELECT 1 FROM migration_log WHERE file_path = $file_path LIMIT 1"
    ),

    markMigrated: db.query(
      "INSERT OR IGNORE INTO migration_log (file_path, migrated_at) VALUES ($file_path, $migrated_at)"
    ),

    // Minimal inserts — only create if missing, never overwrite existing data.
    // Used to ensure parent rows exist before inserting children, regardless
    // of event ordering.
    ensureProject: db.query(`
      INSERT OR IGNORE INTO projects (id, worktree, vcs, created_at, updated_at)
      VALUES ($id, NULL, NULL, $created_at, $created_at)
    `),

    ensureSession: db.query(`
      INSERT OR IGNORE INTO sessions (id, project_id, parent_id, directory, title, version,
        additions, deletions, files_changed, created_at, updated_at, archived_at)
      VALUES ($id, $project_id, NULL, '', '', NULL, 0, 0, 0, $created_at, $created_at, NULL)
    `),

    ensureUserMessage: db.query(`
      INSERT OR IGNORE INTO user_messages (id, session_id, content, synthetic, compaction, turn_duration_ms, undone_at, created_at, updated_at)
      VALUES ($id, $session_id, NULL, 0, 0, NULL, NULL, $created_at, $created_at)
    `),

    ensureAssistantMessage: db.query(`
      INSERT OR IGNORE INTO assistant_messages (id, user_message_id, session_id, agent, provider_id, model_id,
        summary, cost, tokens_in, tokens_out, tokens_reasoning, tokens_cache_read, tokens_cache_write,
        finish, error_type, error_message, created_at, completed_at, updated_at)
      VALUES ($id, $user_message_id, $session_id, NULL, NULL, NULL,
        0, 0, 0, 0, 0, 0, 0, NULL, NULL, NULL, $created_at, NULL, $created_at)
    `),

    ensureStep: db.query(`
      INSERT OR IGNORE INTO steps (id, assistant_message_id, session_id, cost,
        tokens_in, tokens_out, tokens_reasoning, tokens_cache_read, tokens_cache_write,
        finish_reason, created_at, updated_at)
      VALUES ($id, $assistant_message_id, $session_id, 0, 0, 0, 0, 0, 0, NULL, $created_at, $created_at)
    `),

    hasProject: db.query("SELECT 1 FROM projects WHERE id = $id LIMIT 1"),
    hasSession: db.query("SELECT 1 FROM sessions WHERE id = $id LIMIT 1"),
    hasUserMessage: db.query("SELECT 1 FROM user_messages WHERE id = $id LIMIT 1"),
    hasAssistantMessage: db.query("SELECT 1 FROM assistant_messages WHERE id = $id LIMIT 1"),
    hasStep: db.query("SELECT 1 FROM steps WHERE id = $id LIMIT 1"),
  }
}

// ---------------------------------------------------------------------------
// 4. Helpers
// ---------------------------------------------------------------------------

const PLACEHOLDER_PROJECT = "_unknown"

/** Ensure the full parent chain (project → session) exists for a given sessionID. */
function ensureParentChain(stmts, sessionID) {
  if (!sessionID) return
  if (stmts.hasSession.get({ $id: sessionID })) return
  const now = Date.now()
  stmts.ensureProject.run({ $id: PLACEHOLDER_PROJECT, $created_at: now })
  stmts.ensureSession.run({ $id: sessionID, $project_id: PLACEHOLDER_PROJECT, $created_at: now })
}

function insertAssistantBlobIfNew(stmts, assistantMessageId, blobType, content) {
  if (!content) return
  if (stmts.hasAssistantBlob.get({ $assistant_message_id: assistantMessageId, $blob_type: blobType })) return
  const text = typeof content === "string" ? content : JSON.stringify(content)
  stmts.insertAssistantBlob.run({
    $assistant_message_id: assistantMessageId,
    $blob_type: blobType,
    $content: text,
    $size_bytes: Buffer.byteLength(text, "utf8"),
  })
}

function insertToolCallBlobIfNew(stmts, toolCallId, blobType, content) {
  if (!content) return
  if (stmts.hasToolCallBlob.get({ $tool_call_id: toolCallId, $blob_type: blobType })) return
  const text = typeof content === "string" ? content : JSON.stringify(content)
  stmts.insertToolCallBlob.run({
    $tool_call_id: toolCallId,
    $blob_type: blobType,
    $content: text,
    $size_bytes: Buffer.byteLength(text, "utf8"),
  })
}

function getStorageRoot() {
  return join(
    process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"),
    "opencode",
    "storage",
  )
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"))
  } catch {
    return null
  }
}

function listDir(dirPath) {
  try {
    return readdirSync(dirPath)
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// 5. Event handlers — sessions
// ---------------------------------------------------------------------------

function handleSessionEvent(stmts, props) {
  const info = props.info
  if (!info) return

  // Ensure project exists
  if (!stmts.hasProject.get({ $id: info.projectID })) {
    stmts.upsertProject.run({
      $id: info.projectID,
      $worktree: info.directory || null,
      $vcs: null,
      $created_at: info.time?.created || Date.now(),
      $updated_at: Date.now(),
    })
  }

  stmts.upsertSession.run({
    $id: info.id,
    $project_id: info.projectID,
    $parent_id: info.parentID || null,
    $directory: info.directory || "",
    $title: info.title || "",
    $version: info.version || null,
    $additions: info.summary?.additions || 0,
    $deletions: info.summary?.deletions || 0,
    $files_changed: info.summary?.files || 0,
    $created_at: info.time?.created || Date.now(),
    $updated_at: info.time?.updated || info.time?.created || Date.now(),
    $archived_at: info.time?.archived || null,
  })
}

// ---------------------------------------------------------------------------
// 6. Event handlers — messages
// ---------------------------------------------------------------------------

function handleMessageUpdated(stmts, props) {
  const info = props.info
  if (!info) return

  if (info.role === "user") {
    handleUserMessage(stmts, info)
  } else if (info.role === "assistant") {
    handleAssistantMessage(stmts, info)
  }
}

function handleUserMessage(stmts, info) {
  ensureParentChain(stmts, info.sessionID)

  stmts.upsertUserMessage.run({
    $id: info.id,
    $session_id: info.sessionID,
    $content: null,
    $synthetic: 0,
    $compaction: 0,
    $turn_duration_ms: null,
    $undone_at: null,
    $created_at: info.time?.created || Date.now(),
    $updated_at: Date.now(),
  })
}

function handleAssistantMessage(stmts, info) {
  const parentId = info.parentID
  if (!parentId) return

  ensureParentChain(stmts, info.sessionID)
  stmts.ensureUserMessage.run({
    $id: parentId,
    $session_id: info.sessionID,
    $created_at: info.time?.created || Date.now(),
  })

  stmts.upsertAssistantMessage.run({
    $id: info.id,
    $user_message_id: parentId,
    $session_id: info.sessionID,
    $agent: info.agent || null,
    $provider_id: info.providerID || null,
    $model_id: info.modelID || null,
    $summary: info.summary ? 1 : 0,
    $cost: info.cost || 0,
    $tokens_in: info.tokens?.input || 0,
    $tokens_out: info.tokens?.output || 0,
    $tokens_reasoning: info.tokens?.reasoning || 0,
    $tokens_cache_read: info.tokens?.cache?.read || 0,
    $tokens_cache_write: info.tokens?.cache?.write || 0,
    $finish: info.finish || null,
    $error_type: info.error?.name || null,
    $error_message: info.error?.data?.message || null,
    $created_at: info.time?.created || Date.now(),
    $completed_at: info.time?.completed || null,
    $updated_at: Date.now(),
  })

  // Compute turn duration when the final assistant message completes.
  // The final message is the one whose finish reason is NOT "tool-calls"
  // (tool-calls means the loop will continue with another assistant message).
  const finish = info.finish
  const completedAt = info.time?.completed
  if (finish && finish !== "tool-calls" && completedAt) {
    const row = stmts.getUserMessageCreatedAt.get({ $id: parentId })
    if (row?.created_at) {
      const duration = completedAt - row.created_at
      if (duration > 0) {
        stmts.updateTurnDuration.run({
          $id: parentId,
          $turn_duration_ms: duration,
          $updated_at: Date.now(),
        })
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 7. Event handlers — parts (real-time)
//
// In-memory state for step tracking:
//   stepTracker: Map<messageID, stepStartPartID>
//   Updated on step-start, used to link tool calls to their step.
// ---------------------------------------------------------------------------

function handlePartUpdated(stmts, stepTracker, props) {
  const part = props.part
  if (!part) return

  switch (part.type) {
    case "step-start":
      stepTracker.set(part.messageID, part.id)

      // Pre-insert the step row so tool calls can FK-reference it immediately.
      // The assistant message row should already exist (message.updated fires
      // before step-start), but guard defensively in case of event re-ordering.
      if (stmts.hasAssistantMessage.get({ $id: part.messageID })) {
        stmts.upsertStep.run({
          $id: part.id,
          $assistant_message_id: part.messageID,
          $session_id: part.sessionID,
          $cost: 0,
          $tokens_in: 0,
          $tokens_out: 0,
          $tokens_reasoning: 0,
          $tokens_cache_read: 0,
          $tokens_cache_write: 0,
          $finish_reason: null,
          $created_at: Date.now(),
          $updated_at: Date.now(),
        })
      }
      break

    case "step-finish": {
      const stepId = stepTracker.get(part.messageID)
      if (!stepId) break

      // Ensure parent assistant message exists. In normal flow it was created
      // by message.updated before step-start, but for unmigrated sessions or
      // edge cases it may be missing. Skip only if we truly cannot create it.
      if (!stmts.hasAssistantMessage.get({ $id: part.messageID })) break

      stmts.ensureStep.run({
        $id: stepId,
        $assistant_message_id: part.messageID,
        $session_id: part.sessionID,
        $created_at: Date.now(),
      })

      stmts.upsertStep.run({
        $id: stepId,
        $assistant_message_id: part.messageID,
        $session_id: part.sessionID,
        $cost: part.cost || 0,
        $tokens_in: part.tokens?.input || 0,
        $tokens_out: part.tokens?.output || 0,
        $tokens_reasoning: part.tokens?.reasoning || 0,
        $tokens_cache_read: part.tokens?.cache?.read || 0,
        $tokens_cache_write: part.tokens?.cache?.write || 0,
        $finish_reason: part.reason || null,
        $created_at: Date.now(),
        $updated_at: Date.now(),
      })
      break
    }

    case "tool": {
      const state = part.state
      if (!state) break

      // Handle compaction: tool output was pruned
      if (state.time?.compacted) {
        stmts.setToolCallCompacted.run({
          $id: part.id,
          $compacted_at: state.time.compacted,
          $updated_at: Date.now(),
        })
        // Don't return — also process completed/error state below if applicable
      }

      // Only persist completed or error states (pending/running are transient)
      if (state.status !== "completed" && state.status !== "error") break

      const stepId = stepTracker.get(part.messageID)
      if (!stepId) break

      // Ensure step row exists
      if (!stmts.hasAssistantMessage.get({ $id: part.messageID })) break

      stmts.ensureStep.run({
        $id: stepId,
        $assistant_message_id: part.messageID,
        $session_id: part.sessionID,
        $created_at: Date.now(),
      })

      const startedAt = state.time?.start || null
      const completedAt = state.time?.end || null
      const durationMs = (startedAt && completedAt) ? completedAt - startedAt : null

      stmts.upsertToolCall.run({
        $id: part.id,
        $step_id: stepId,
        $session_id: part.sessionID,
        $call_id: part.callID || "",
        $tool: part.tool || "",
        $status: state.status,
        $title: state.title || null,
        $error: state.error || null,
        $compacted_at: state.time?.compacted || null,
        $started_at: startedAt,
        $completed_at: completedAt,
        $duration_ms: durationMs,
        $updated_at: Date.now(),
      })

      // Store input/output as blobs
      if (state.input) {
        insertToolCallBlobIfNew(stmts, part.id, "tool_input", state.input)
      }
      if (state.status === "completed" && state.output) {
        insertToolCallBlobIfNew(stmts, part.id, "tool_output", state.output)
      }
      break
    }

    case "text":
      // For user messages: capture content inline
      if (!props.delta && part.text) {
        // Check if this is a user message text part
        const isUserMsg = stmts.hasUserMessage.get({ $id: part.messageID })
        if (isUserMsg) {
          // Check for synthetic marker on the part
          const isSynthetic = part.synthetic ? 1 : 0
          stmts.upsertUserMessage.run({
            $id: part.messageID,
            $session_id: part.sessionID,
            $content: part.text,
            $synthetic: isSynthetic,
            $compaction: 0,
            $turn_duration_ms: null,
            $undone_at: null,
            $created_at: Date.now(),
            $updated_at: Date.now(),
          })
        } else if (stmts.hasAssistantMessage.get({ $id: part.messageID })) {
          // Assistant text → store as blob
          insertAssistantBlobIfNew(stmts, part.messageID, "text", part.text)
        }
      }
      break

    case "reasoning":
      // Only store the final reasoning (skip streaming deltas)
      if (!props.delta && part.text) {
        if (stmts.hasAssistantMessage.get({ $id: part.messageID })) {
          insertAssistantBlobIfNew(stmts, part.messageID, "reasoning", part.text)
        }
      }
      break

    case "compaction":
      // This part fires on the user message that triggered compaction
      stmts.markUserMessageCompaction.run({ $id: part.messageID, $updated_at: Date.now() })
      break
  }
}

// ---------------------------------------------------------------------------
// 8. Event handlers — message removed (undo)
// ---------------------------------------------------------------------------

function handleMessageRemoved(stmts, props) {
  const messageID = props.messageID
  if (!messageID) return

  // Only mark user messages as undone. Assistant messages are covered
  // by the parent user message's undone_at flag.
  if (stmts.hasUserMessage.get({ $id: messageID })) {
    stmts.markUserMessageUndone.run({
      $id: messageID,
      $undone_at: Date.now(),
      $updated_at: Date.now(),
    })
  }
}

// ---------------------------------------------------------------------------
// 9. Migration: walk JSON storage and backfill the database
// ---------------------------------------------------------------------------

function runMigration(db, stmts) {
  const root = getStorageRoot()
  if (!existsSync(root)) return "Storage directory not found: " + root

  // Temporarily disable FK checks so sessions with parent_id can be inserted
  // in any order. Re-enabled at the end.
  db.run("PRAGMA foreign_keys = OFF")

  const now = Date.now()
  const counts = { projects: 0, sessions: 0, messages: 0, parts: 0, skipped: 0 }

  // --- Projects ---
  const projectDir = join(root, "project")
  for (const file of listDir(projectDir)) {
    if (!file.endsWith(".json")) continue
    const relPath = "project/" + file
    if (stmts.isMigrated.get({ $file_path: relPath })) { counts.skipped++; continue }

    const data = readJsonSafe(join(projectDir, file))
    if (!data || !data.id) continue

    const projTs = data.time?.created || null
    stmts.upsertProject.run({
      $id: data.id,
      $worktree: data.worktree || null,
      $vcs: data.vcs || null,
      $created_at: projTs,
      $updated_at: projTs,
    })
    stmts.markMigrated.run({ $file_path: relPath, $migrated_at: now })
    counts.projects++
  }

  // --- Sessions (per project) ---
  const sessionBaseDir = join(root, "session")
  for (const projectId of listDir(sessionBaseDir)) {
    const sessionDir = join(sessionBaseDir, projectId)
    for (const file of listDir(sessionDir)) {
      if (!file.endsWith(".json")) continue
      const relPath = "session/" + projectId + "/" + file
      if (stmts.isMigrated.get({ $file_path: relPath })) { counts.skipped++; continue }

      const data = readJsonSafe(join(sessionDir, file))
      if (!data || !data.id) continue

      // Ensure project row exists
      if (!stmts.hasProject.get({ $id: data.projectID || projectId })) {
        const sessProjTs = data.time?.created || null
        stmts.upsertProject.run({
          $id: data.projectID || projectId,
          $worktree: data.directory || null,
          $vcs: null,
          $created_at: sessProjTs,
          $updated_at: sessProjTs,
        })
      }

      // Ensure parent session exists if this is a subtask session
      if (data.parentID && !stmts.hasSession.get({ $id: data.parentID })) {
        stmts.ensureSession.run({
          $id: data.parentID,
          $project_id: data.projectID || projectId,
          $created_at: data.time?.created || 0,
        })
      }

      stmts.upsertSession.run({
        $id: data.id,
        $project_id: data.projectID || projectId,
        $parent_id: data.parentID || null,
        $directory: data.directory || "",
        $title: data.title || "",
        $version: data.version || null,
        $additions: data.summary?.additions || 0,
        $deletions: data.summary?.deletions || 0,
        $files_changed: data.summary?.files || 0,
        $created_at: data.time?.created || 0,
        $updated_at: data.time?.updated || data.time?.created || 0,
        $archived_at: data.time?.archived || null,
      })
      stmts.markMigrated.run({ $file_path: relPath, $migrated_at: now })
      counts.sessions++
    }
  }

  // --- Messages + Parts (per session) ---
  const messageBaseDir = join(root, "message")
  for (const sessionId of listDir(messageBaseDir)) {
    const messageDir = join(messageBaseDir, sessionId)

    // Wrap each session in a transaction for speed
    const migrateSession = db.transaction(() => {
      // First pass: collect all messages for this session
      const messages = []
      for (const file of listDir(messageDir)) {
        if (!file.endsWith(".json")) continue
        const data = readJsonSafe(join(messageDir, file))
        if (!data || !data.id) continue
        messages.push({ file, data })
      }

      // Sort messages by creation time to ensure user messages are inserted before
      // their assistant message children
      messages.sort((a, b) => (a.data.time?.created || 0) - (b.data.time?.created || 0))

      let lastUserMessageId = null
      for (const { file, data } of messages) {
        const relPath = "message/" + sessionId + "/" + file
        if (stmts.isMigrated.get({ $file_path: relPath })) {
          // Still track last user message ID even for already-migrated messages
          // so the fallback parentID is available for subsequent assistant messages
          if (data.role === "user") lastUserMessageId = data.id
          counts.skipped++; continue
        }

        // Ensure session exists
        if (!stmts.hasSession.get({ $id: data.sessionID || sessionId })) continue

        const sid = data.sessionID || sessionId

        if (data.role === "user") {
          migrateUserMessage(stmts, data, sid)
          lastUserMessageId = data.id
        } else if (data.role === "assistant") {
          migrateAssistantMessage(stmts, data, sid, lastUserMessageId)
        }
        stmts.markMigrated.run({ $file_path: relPath, $migrated_at: now })
        counts.messages++

        // --- Parts for this message ---
        const partDir = join(root, "part", data.id)
        const partFiles = []
        for (const partFile of listDir(partDir)) {
          if (!partFile.endsWith(".json")) continue
          const part = readJsonSafe(join(partDir, partFile))
          if (!part || !part.id) continue
          partFiles.push({ partFile, part })
        }

        // Sort parts by ID (monotonically ascending = chronological order)
        partFiles.sort((a, b) => (a.part.id > b.part.id ? 1 : -1))

        // Walk parts in order to reconstruct step→tool_call linkage
        let currentStepId = null
        for (const { partFile, part } of partFiles) {
          const partRelPath = "part/" + data.id + "/" + partFile
          if (stmts.isMigrated.get({ $file_path: partRelPath })) { counts.skipped++; continue }

          migratePart(stmts, part, sid, data, currentStepId, (newStepId) => {
            currentStepId = newStepId
          })
          stmts.markMigrated.run({ $file_path: partRelPath, $migrated_at: now })
          counts.parts++
        }
      }
    })

    migrateSession()
  }

  // Re-enable FK checks
  db.run("PRAGMA foreign_keys = ON")

  // Backfill turn_duration_ms from migrated data.
  // For each user message, compute duration as MAX(assistant completed_at) - user created_at.
  db.run(`
    UPDATE user_messages
    SET turn_duration_ms = (
      SELECT MAX(am.completed_at) - user_messages.created_at
      FROM assistant_messages am
      WHERE am.user_message_id = user_messages.id
        AND am.completed_at IS NOT NULL
    ),
    updated_at = ${Date.now()}
    WHERE turn_duration_ms IS NULL
      AND created_at IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM assistant_messages am
        WHERE am.user_message_id = user_messages.id
          AND am.completed_at IS NOT NULL
      )
      AND (
        SELECT MAX(am.completed_at) - user_messages.created_at
        FROM assistant_messages am
        WHERE am.user_message_id = user_messages.id
          AND am.completed_at IS NOT NULL
      ) > 0
  `)

  return `Migration complete: ${counts.projects} projects, ${counts.sessions} sessions, ${counts.messages} messages, ${counts.parts} parts (${counts.skipped} already migrated)`
}

function migrateUserMessage(stmts, data, sessionId) {
  // We'll set content, synthetic, compaction from parts later
  // turn_duration_ms is backfilled after all messages are migrated
  const ts = data.time?.created || 0
  stmts.upsertUserMessage.run({
    $id: data.id,
    $session_id: sessionId,
    $content: null,
    $synthetic: 0,
    $compaction: 0,
    $turn_duration_ms: null,
    $undone_at: null,
    $created_at: ts,
    $updated_at: ts,
  })
}

function migrateAssistantMessage(stmts, data, sessionId, fallbackParentId) {
  const parentId = data.parentID || fallbackParentId
  if (!parentId) return
  if (!stmts.hasUserMessage.get({ $id: parentId })) return

  const ts = data.time?.created || 0
  stmts.upsertAssistantMessage.run({
    $id: data.id,
    $user_message_id: parentId,
    $session_id: sessionId,
    $agent: data.agent || null,
    $provider_id: data.providerID || null,
    $model_id: data.modelID || null,
    $summary: data.summary ? 1 : 0,
    $cost: data.cost || 0,
    $tokens_in: data.tokens?.input || 0,
    $tokens_out: data.tokens?.output || 0,
    $tokens_reasoning: data.tokens?.reasoning || 0,
    $tokens_cache_read: data.tokens?.cache?.read || 0,
    $tokens_cache_write: data.tokens?.cache?.write || 0,
    $finish: data.finish || null,
    $error_type: data.error?.name || null,
    $error_message: data.error?.data?.message || null,
    $created_at: ts,
    $completed_at: data.time?.completed || null,
    $updated_at: ts,
  })
}

function migratePart(stmts, part, sessionId, messageData, currentStepId, setStepId) {
  const ts = messageData.time?.created || 0
  switch (part.type) {
    case "step-start":
      // Insert step row (will be updated by step-finish)
      if (stmts.hasAssistantMessage.get({ $id: part.messageID })) {
        stmts.upsertStep.run({
          $id: part.id,
          $assistant_message_id: part.messageID,
          $session_id: sessionId,
          $cost: 0,
          $tokens_in: 0,
          $tokens_out: 0,
          $tokens_reasoning: 0,
          $tokens_cache_read: 0,
          $tokens_cache_write: 0,
          $finish_reason: null,
          $created_at: part.time?.start || null,
          $updated_at: ts,
        })
      }
      setStepId(part.id)
      break

    case "step-finish":
      // Update the step row created by step-start
      if (currentStepId && stmts.hasStep.get({ $id: currentStepId })) {
        stmts.upsertStep.run({
          $id: currentStepId,
          $assistant_message_id: part.messageID,
          $session_id: sessionId,
          $cost: part.cost || 0,
          $tokens_in: part.tokens?.input || 0,
          $tokens_out: part.tokens?.output || 0,
          $tokens_reasoning: part.tokens?.reasoning || 0,
          $tokens_cache_read: part.tokens?.cache?.read || 0,
          $tokens_cache_write: part.tokens?.cache?.write || 0,
          $finish_reason: part.reason || null,
          $created_at: part.time?.start || null,
          $updated_at: ts,
        })
      }
      break

    case "tool": {
      const state = part.state
      if (!state) break
      if (state.status === "pending" || state.status === "running") break
      if (!currentStepId) break
      if (!stmts.hasStep.get({ $id: currentStepId })) break

      const startedAt = state.time?.start || null
      const completedAt = state.time?.end || null
      const durationMs = (startedAt && completedAt) ? completedAt - startedAt : null

      stmts.upsertToolCall.run({
        $id: part.id,
        $step_id: currentStepId,
        $session_id: sessionId,
        $call_id: part.callID || "",
        $tool: part.tool || "",
        $status: state.status,
        $title: state.title || null,
        $error: state.error || null,
        $compacted_at: state.time?.compacted || null,
        $started_at: startedAt,
        $completed_at: completedAt,
        $duration_ms: durationMs,
        $updated_at: ts,
      })

      if (state.input) {
        insertToolCallBlobIfNew(stmts, part.id, "tool_input", state.input)
      }
      if (state.status === "completed" && state.output) {
        insertToolCallBlobIfNew(stmts, part.id, "tool_output", state.output)
      }
      break
    }

    case "text":
      if (part.text) {
        if (messageData.role === "user") {
          // Update user message content inline
          const isSynthetic = part.synthetic ? 1 : 0
          stmts.upsertUserMessage.run({
            $id: part.messageID,
            $session_id: sessionId,
            $content: part.text,
            $synthetic: isSynthetic,
            $compaction: 0,
            $turn_duration_ms: null,
            $undone_at: null,
            $created_at: ts,
            $updated_at: ts,
          })
        } else if (stmts.hasAssistantMessage.get({ $id: part.messageID })) {
          insertAssistantBlobIfNew(stmts, part.messageID, "text", part.text)
        }
      }
      break

    case "reasoning":
      if (part.text && stmts.hasAssistantMessage.get({ $id: part.messageID })) {
        insertAssistantBlobIfNew(stmts, part.messageID, "reasoning", part.text)
      }
      break

    case "compaction":
      stmts.markUserMessageCompaction.run({ $id: part.messageID, $updated_at: ts })
      break
  }
}

// ---------------------------------------------------------------------------
// 10. Plugin export
// ---------------------------------------------------------------------------

export const UsageTracker = async ({ project }) => {
  const db = initDb()
  const stmts = prepareStatements(db)

  // In-memory tracker: messageID → current step-start part ID
  const stepTracker = new Map()

  // Upsert current project on load
  if (project) {
    stmts.upsertProject.run({
      $id: project.id,
      $worktree: project.worktree || null,
      $vcs: project.vcs || null,
      $created_at: project.time?.created || Date.now(),
      $updated_at: Date.now(),
    })
  }

  return {
    // -- Custom tool: manual migration --
    tool: {
      "migrate-usage": tool({
        description: "Migrate all existing OpenCode session data from JSON storage into the usage tracking SQLite database. Run this once to backfill historical data.",
        args: {},
        async execute() {
          return runMigration(db, stmts)
        },
      }),
    },

    // -- Event hook: real-time tracking --
    event: async ({ event }) => {
      try {
        switch (event.type) {
          case "session.created":
          case "session.updated":
            handleSessionEvent(stmts, event.properties)
            break
          case "message.updated":
            handleMessageUpdated(stmts, event.properties)
            break
          case "message.part.updated":
            handlePartUpdated(stmts, stepTracker, event.properties)
            break
          case "message.removed":
            handleMessageRemoved(stmts, event.properties)
            break
        }
      } catch (err) {
        // Never block the user's workflow
        console.error("[usage-tracker]", err?.message || err)
      }
    },

    // -- chat.message hook: capture user message content early --
    "chat.message": async (input, next) => {
      try {
        if (input.sessionID) {
          ensureParentChain(stmts, input.sessionID)
        }

        if (next.message) {
          handleUserMessage(stmts, next.message)
          // Capture user's input text from the resolved parts array.
          // `next.parts` contains the MessageV2.Part[] built by createUserMessage
          // before persistence. `input` only has { sessionID, agent, model, ... }.
          if (next.message.id && next.parts) {
            const text = next.parts
              .filter((p) => p.type === "text" && p.text)
              .map((p) => p.text)
              .join("\n") || null
            if (text) {
              stmts.upsertUserMessage.run({
                $id: next.message.id,
                $session_id: input.sessionID,
                $content: text,
                $synthetic: 0,
                $compaction: 0,
                $turn_duration_ms: null,
                $undone_at: null,
                $created_at: next.message.time?.created || Date.now(),
                $updated_at: Date.now(),
              })
            }
          }
        }
      } catch (err) {
        console.error("[usage-tracker]", err?.message || err)
      }
    },
  }
}
