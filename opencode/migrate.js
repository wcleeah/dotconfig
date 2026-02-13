#!/usr/bin/env bun
// ---------------------------------------------------------------------------
// Standalone migration script for the usage-tracker plugin.
//
// Reads JSON files from ~/.local/share/opencode/storage/ and backfills them
// into the usage tracking SQLite database (~/.local/share/opencode/usage.db).
//
// Usage:
//   bun ~/.config/opencode/migrate.js
//
// Safe to re-run — already-migrated files are tracked in the migration_log
// table and skipped on subsequent runs.
// ---------------------------------------------------------------------------

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
// 3. Prepared statements (migration-only subset)
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

    markUserMessageCompaction: db.query(
      "UPDATE user_messages SET compaction = 1, synthetic = 1, updated_at = $updated_at WHERE id = $id"
    ),

    ensureSession: db.query(`
      INSERT OR IGNORE INTO sessions (id, project_id, parent_id, directory, title, version,
        additions, deletions, files_changed, created_at, updated_at, archived_at)
      VALUES ($id, $project_id, NULL, '', '', NULL, 0, 0, 0, $created_at, $created_at, NULL)
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

// ---------------------------------------------------------------------------
// 5. Migration logic
// ---------------------------------------------------------------------------

function runMigration(db, stmts) {
  const root = getStorageRoot()
  if (!existsSync(root)) {
    console.error("Storage directory not found:", root)
    process.exit(1)
  }

  // Temporarily disable FK checks so sessions with parent_id can be inserted
  // in any order. Re-enabled at the end.
  db.run("PRAGMA foreign_keys = OFF")

  const now = Date.now()
  const counts = { projects: 0, sessions: 0, messages: 0, parts: 0, skipped: 0, errors: 0 }

  console.log("Migrating projects...")
  const projectDir = join(root, "project")
  for (const file of listDir(projectDir)) {
    if (!file.endsWith(".json")) continue
    const relPath = "project/" + file
    if (stmts.isMigrated.get({ $file_path: relPath })) { counts.skipped++; continue }

    const data = readJsonSafe(join(projectDir, file))
    if (!data || !data.id) continue

    try {
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
    } catch (err) {
      console.error("  Error migrating project", file, ":", err.message)
      counts.errors++
    }
  }
  console.log(`  ${counts.projects} projects migrated`)

  console.log("Migrating sessions...")
  const sessionBaseDir = join(root, "session")
  for (const projectId of listDir(sessionBaseDir)) {
    const sessionDir = join(sessionBaseDir, projectId)
    for (const file of listDir(sessionDir)) {
      if (!file.endsWith(".json")) continue
      const relPath = "session/" + projectId + "/" + file
      if (stmts.isMigrated.get({ $file_path: relPath })) { counts.skipped++; continue }

      const data = readJsonSafe(join(sessionDir, file))
      if (!data || !data.id) continue

      try {
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
      } catch (err) {
        console.error("  Error migrating session", file, ":", err.message)
        counts.errors++
      }
    }
  }
  console.log(`  ${counts.sessions} sessions migrated`)

  console.log("Migrating messages and parts...")
  const messageBaseDir = join(root, "message")
  for (const sessionId of listDir(messageBaseDir)) {
    const messageDir = join(messageBaseDir, sessionId)

    const migrateSession = db.transaction(() => {
      const messages = []
      for (const file of listDir(messageDir)) {
        if (!file.endsWith(".json")) continue
        const data = readJsonSafe(join(messageDir, file))
        if (!data || !data.id) continue
        messages.push({ file, data })
      }

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

        if (!stmts.hasSession.get({ $id: data.sessionID || sessionId })) continue

        const sid = data.sessionID || sessionId

        try {
          if (data.role === "user") {
            migrateUserMessage(stmts, data, sid)
            lastUserMessageId = data.id
          } else if (data.role === "assistant") {
            migrateAssistantMessage(stmts, data, sid, lastUserMessageId)
          }
          stmts.markMigrated.run({ $file_path: relPath, $migrated_at: now })
          counts.messages++
        } catch (err) {
          console.error("  Error migrating message", file, ":", err.message)
          counts.errors++
          continue
        }

        const partDir = join(root, "part", data.id)
        const partFiles = []
        for (const partFile of listDir(partDir)) {
          if (!partFile.endsWith(".json")) continue
          const part = readJsonSafe(join(partDir, partFile))
          if (!part || !part.id) continue
          partFiles.push({ partFile, part })
        }

        partFiles.sort((a, b) => (a.part.id > b.part.id ? 1 : -1))

        let currentStepId = null
        for (const { partFile, part } of partFiles) {
          const partRelPath = "part/" + data.id + "/" + partFile
          if (stmts.isMigrated.get({ $file_path: partRelPath })) { counts.skipped++; continue }

          try {
            migratePart(stmts, part, sid, data, currentStepId, (newStepId) => {
              currentStepId = newStepId
            })
            stmts.markMigrated.run({ $file_path: partRelPath, $migrated_at: now })
            counts.parts++
          } catch (err) {
            console.error("  Error migrating part", partFile, "for message", data.id, ":", err.message)
            counts.errors++
          }
        }
      }
    })

    try {
      migrateSession()
    } catch (err) {
      console.error("  Error migrating session", sessionId, ":", err.message)
      counts.errors++
    }
  }
  console.log(`  ${counts.messages} messages, ${counts.parts} parts migrated`)

  // Re-enable FK checks
  db.run("PRAGMA foreign_keys = ON")

  // Backfill turn_duration_ms from migrated data.
  // For each user message, compute duration as MAX(assistant completed_at) - user created_at.
  console.log("Backfilling turn durations...")
  const backfillResult = db.run(`
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
  console.log(`  ${backfillResult.changes} turn durations computed`)

  return counts
}

// ---------------------------------------------------------------------------
// 6. Message/Part migration helpers
// ---------------------------------------------------------------------------

function migrateUserMessage(stmts, data, sessionId) {
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
// 7. Main
// ---------------------------------------------------------------------------

const dbPath = getDbPath()
console.log("Usage tracker migration")
console.log("DB path:", dbPath)
console.log("")

const db = initDb()
const stmts = prepareStatements(db)

const start = performance.now()
const counts = runMigration(db, stmts)
const elapsed = ((performance.now() - start) / 1000).toFixed(2)

db.close()

console.log("")
console.log("Done in", elapsed + "s")
console.log(`  Projects:  ${counts.projects}`)
console.log(`  Sessions:  ${counts.sessions}`)
console.log(`  Messages:  ${counts.messages}`)
console.log(`  Parts:     ${counts.parts}`)
console.log(`  Skipped:   ${counts.skipped}`)
if (counts.errors > 0) {
  console.log(`  Errors:    ${counts.errors}`)
  process.exit(1)
}
