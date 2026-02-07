#!/usr/bin/env bun
/**
 * Usage Tracker Migration Script
 * 
 * One-time migration of OpenCode JSON data to SQLite database.
 * Reads from ~/.local/share/opencode/storage/ and populates usage.db
 */

import { Database } from "bun:sqlite"
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { expandPath, ensureDirectoryExists, logError } from "./usage-tracker/utils"
import { SCHEMA } from "./usage-tracker/schema"

const STORAGE_ROOT = `${process.env.HOME}/.local/share/opencode/storage`
const DEFAULT_DB_PATH = `${process.env.HOME}/.config/opencode/usage.db`

// Types matching OpenCode's JSON structure
interface SessionJSON {
  id: string
  projectID: string
  directory: string
  parentID?: string
  title: string
  version: string
  time: {
    created: number
    updated: number
    compacting?: number
  }
  summary?: {
    additions: number
    deletions: number
    files: number
    diffs?: Array<{
      file: string
      before: string
      after: string
      additions: number
      deletions: number
    }>
  }
}

interface UserMessageJSON {
  id: string
  sessionID: string
  role: "user"
  time: { created: number }
  summary?: {
    title?: string
    body?: string
    diffs: Array<any>
  }
  agent: string
  model: {
    providerID: string
    modelID: string
  }
  system?: string
}

interface AssistantMessageJSON {
  id: string
  sessionID: string
  role: "assistant"
  time: {
    created: number
    completed?: number
  }
  error?: any
  parentID: string
  modelID: string
  providerID: string
  mode: string
  path: {
    cwd: string
    root: string
  }
  summary?: boolean
  cost: number
  tokens: {
    input: number
    output: number
    reasoning: number
    cache: {
      read: number
      write: number
    }
  }
  finish?: string
}

type MessageJSON = UserMessageJSON | AssistantMessageJSON

interface TextPartJSON {
  id: string
  sessionID: string
  messageID: string
  type: "text"
  text: string
  synthetic?: boolean
  ignored?: boolean
  time?: { start: number; end?: number }
}

interface ToolPartJSON {
  id: string
  sessionID: string
  messageID: string
  type: "tool"
  callID: string
  tool: string
  state: {
    status: "pending" | "running" | "completed" | "error"
    input: Record<string, unknown>
    output?: string
    error?: string
    title?: string
    metadata?: Record<string, unknown>
    time: {
      start: number
      end?: number
    }
  }
}

interface CompactionPartJSON {
  id: string
  sessionID: string
  messageID: string
  type: "compaction"
  auto: boolean
}

type PartJSON = TextPartJSON | ToolPartJSON | CompactionPartJSON | any

// Migration state
interface MigrationStats {
  sessionsTotal: number
  sessionsProcessed: number
  sessionsSkipped: number
  messagesProcessed: number
  messagesSkipped: number
  toolCallsProcessed: number
  toolCallsSkipped: number
  errors: number
}

const initDatabase = (dbPath: string): Database => {
  const expandedPath = expandPath(dbPath)
  ensureDirectoryExists(expandedPath)
  const db = new Database(expandedPath, { create: true })
  
  const statements = SCHEMA.split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  for (const stmt of statements) {
    try {
      db.exec(stmt)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes("duplicate column")) {
        console.warn(`Warning: ${msg}`)
      }
    }
  }

  return db
}

const getSessionFiles = (storageRoot: string): Array<{ projectID: string; sessionID: string; path: string }> => {
  const sessions: Array<{ projectID: string; sessionID: string; path: string }> = []
  
  const sessionDir = join(storageRoot, "session")
  if (!existsSync(sessionDir)) {
    console.log("No session directory found")
    return sessions
  }

  // Iterate through project directories
  for (const projectID of readdirSync(sessionDir)) {
    const projectPath = join(sessionDir, projectID)
    try {
      const stat = statSync(projectPath)
      if (!stat.isDirectory()) continue

      // Iterate through session files in this project
      for (const sessionFile of readdirSync(projectPath)) {
        if (!sessionFile.endsWith(".json")) continue
        const sessionID = sessionFile.replace(".json", "")
        sessions.push({
          projectID,
          sessionID,
          path: join(projectPath, sessionFile)
        })
      }
    } catch (err) {
      console.warn(`Warning: Could not read project ${projectID}:`, err)
    }
  }

  return sessions
}

const getMessageFiles = (storageRoot: string, sessionID: string): Array<{ messageID: string; path: string }> => {
  const messages: Array<{ messageID: string; path: string }> = []
  
  const messageDir = join(storageRoot, "message", sessionID)
  if (!existsSync(messageDir)) return messages

  for (const messageFile of readdirSync(messageDir)) {
    if (!messageFile.endsWith(".json")) continue
    messages.push({
      messageID: messageFile.replace(".json", ""),
      path: join(messageDir, messageFile)
    })
  }

  return messages
}

const getPartFiles = (storageRoot: string, messageID: string): Array<{ partID: string; path: string }> => {
  const parts: Array<{ partID: string; path: string }> = []
  
  const partDir = join(storageRoot, "part", messageID)
  if (!existsSync(partDir)) return parts

  for (const partFile of readdirSync(partDir)) {
    if (!partFile.endsWith(".json")) continue
    parts.push({
      partID: partFile.replace(".json", ""),
      path: join(partDir, partFile)
    })
  }

  return parts
}

const migrateSession = (
  db: Database,
  session: SessionJSON,
  worktree: string,
  stats: MigrationStats
): MigrationStats => {
  try {
    // Check if session already exists
    const existing = db.prepare("SELECT 1 FROM sessions WHERE id = ?").get(session.id)
    if (existing) {
      return { ...stats, sessionsSkipped: stats.sessionsSkipped + 1 }
    }

    db.prepare(`
      INSERT INTO sessions (id, title, parent_id, project_path, worktree, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      session.id,
      session.title ?? null,
      session.parentID ?? null,
      session.directory,
      worktree,
      session.time.created,
      session.time.updated
    )

    return { ...stats, sessionsProcessed: stats.sessionsProcessed + 1 }
  } catch (err) {
    logError(db, "migrate.session", { sessionId: session.id, worktree }, err)
    return { ...stats, errors: stats.errors + 1 }
  }
}

const migrateMessage = (
  db: Database,
  message: MessageJSON,
  turnID: string | null,
  stats: MigrationStats
): MigrationStats => {
  try {
    // Check if message already exists
    const existing = db.prepare("SELECT 1 FROM messages WHERE id = ?").get(message.id)
    if (existing) {
      return { ...stats, messagesSkipped: stats.messagesSkipped + 1 }
    }

    if (message.role === "assistant") {
      const msg = message as AssistantMessageJSON
      db.prepare(`
        INSERT INTO messages (
          id, session_id, turn_id, role, model_id, provider_id,
          created_at, completed_at, input_tokens, output_tokens, reasoning_tokens,
          cache_read_tokens, cache_write_tokens, cost, finish_reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        msg.id,
        msg.sessionID,
        turnID,
        msg.role,
        msg.modelID,
        msg.providerID,
        msg.time.created,
        msg.time.completed ?? null,
        msg.tokens.input,
        msg.tokens.output,
        msg.tokens.reasoning,
        msg.tokens.cache.read,
        msg.tokens.cache.write,
        msg.cost,
        msg.finish ?? null
      )
    } else {
      const msg = message as UserMessageJSON
      const parentID = db.prepare("SELECT parent_id FROM sessions WHERE id = ?").get(msg.sessionID) as { parent_id: string | null } | undefined
      const isSubagentPrompt = parentID?.parent_id ? 1 : 0

      db.prepare(`
        INSERT INTO messages (
          id, session_id, turn_id, role, agent, is_subagent_prompt, model_id, provider_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        msg.id,
        msg.sessionID,
        turnID,
        msg.role,
        msg.agent ?? null,
        isSubagentPrompt,
        msg.model?.modelID ?? null,
        msg.model?.providerID ?? null,
        msg.time.created
      )
    }

    return { ...stats, messagesProcessed: stats.messagesProcessed + 1 }
  } catch (err) {
    logError(db, "migrate.message", { messageId: message.id }, err)
    return { ...stats, errors: stats.errors + 1 }
  }
}

const migrateToolPart = (
  db: Database,
  part: ToolPartJSON,
  turnID: string | null,
  stats: MigrationStats
): MigrationStats => {
  try {
    // Check if tool call already exists
    const existing = db.prepare("SELECT 1 FROM tool_calls WHERE id = ?").get(part.callID)
    if (existing) {
      return { ...stats, toolCallsSkipped: stats.toolCallsSkipped + 1 }
    }

    const toolState = part.state
    const success = toolState.status === "completed" ? 1 : 0
    const errorMessage = toolState.status === "error" ? toolState.error : null

    db.prepare(`
      INSERT INTO tool_calls (
        id, session_id, turn_id, message_id, tool_name, args_json,
        started_at, completed_at, duration_ms, success, error_message, output_metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      part.callID,
      part.sessionID,
      turnID,
      part.messageID,
      part.tool,
      JSON.stringify(toolState.input),
      toolState.time.start,
      toolState.time.end ?? null,
      toolState.time.end ? toolState.time.end - toolState.time.start : null,
      success,
      errorMessage,
      JSON.stringify(toolState.metadata ?? {})
    )

    return { ...stats, toolCallsProcessed: stats.toolCallsProcessed + 1 }
  } catch (err) {
    logError(db, "migrate.tool", { partId: part.id }, err)
    return { ...stats, errors: stats.errors + 1 }
  }
}

const migrateSessionData = (
  db: Database,
  sessionFile: { projectID: string; sessionID: string; path: string },
  storageRoot: string,
  stats: MigrationStats
): MigrationStats => {
  try {
    // Read session JSON
    const sessionData: SessionJSON = JSON.parse(readFileSync(sessionFile.path, "utf-8"))
    
    // Use project directory as worktree (best guess)
    const worktree = sessionData.directory
    
    // Migrate session
    stats = migrateSession(db, sessionData, worktree, stats)

    // Get messages for this session
    const messageFiles = getMessageFiles(storageRoot, sessionFile.sessionID)
    
    // Track turn IDs
    let currentTurnID: string | null = null
    
    // Process messages in order (by creation time)
    const messages: Array<{ file: typeof messageFiles[0]; data: MessageJSON }> = []
    for (const messageFile of messageFiles) {
      try {
        const messageData: MessageJSON = JSON.parse(readFileSync(messageFile.path, "utf-8"))
        messages.push({ file: messageFile, data: messageData })
      } catch (err) {
        console.warn(`Warning: Could not read message ${messageFile.messageID}:`, err)
      }
    }

    // Sort by creation time
    messages.sort((a, b) => a.data.time.created - b.data.time.created)

    // Process each message
    for (const { data: message } of messages) {
      // For user messages (not subagent), create a new turn
      if (message.role === "user") {
        const userMsg = message as UserMessageJSON
        const parentID = db.prepare("SELECT parent_id FROM sessions WHERE id = ?").get(userMsg.sessionID) as { parent_id: string | null } | undefined
        const isSubagentPrompt = parentID?.parent_id ? 1 : 0

        if (!isSubagentPrompt) {
          currentTurnID = userMsg.id
          
          // Create turn
          try {
            db.prepare(`
              INSERT OR IGNORE INTO turns (id, session_id, parent_turn_id, user_message, started_at)
              VALUES (?, ?, ?, ?, ?)
            `).run(
              currentTurnID,
              userMsg.sessionID,
              null,
              null, // Will be updated when we process parts
              userMsg.time.created
            )
          } catch (err) {
            logError(db, "migrate.turn", { turnId: currentTurnID }, err)
          }
        }
      }

      // Migrate message
      stats = migrateMessage(db, message, currentTurnID, stats)

      // Process parts for this message
      const partFiles = getPartFiles(storageRoot, message.id)
      
      for (const partFile of partFiles) {
        try {
          const partData: PartJSON = JSON.parse(readFileSync(partFile.path, "utf-8"))
          
          if (partData.type === "tool") {
            stats = migrateToolPart(db, partData as ToolPartJSON, currentTurnID, stats)
          }
          // Note: We don't need to migrate text parts separately as message content 
          // is already captured in the message table
        } catch (err) {
          console.warn(`Warning: Could not read part ${partFile.partId}:`, err)
        }
      }
    }

    return stats
  } catch (err) {
    console.error(`Error migrating session ${sessionFile.sessionID}:`, err)
    logError(db, "migrate.session.error", { sessionId: sessionFile.sessionID }, err)
    return { ...stats, errors: stats.errors + 1 }
  }
}

const runMigration = async (): Promise<void> => {
  const dbPath = process.env.OPENCODE_USAGE_DB || DEFAULT_DB_PATH
  const storageRoot = STORAGE_ROOT

  console.log("=".repeat(60))
  console.log("OpenCode Usage Tracker Migration")
  console.log("=".repeat(60))
  console.log()
  console.log(`Storage: ${storageRoot}`)
  console.log(`Database: ${dbPath}`)
  console.log()

  // Check storage exists
  if (!existsSync(storageRoot)) {
    console.error(`Error: Storage directory not found: ${storageRoot}`)
    console.error("Make sure OpenCode has been used before running migration.")
    process.exit(1)
  }

  // Initialize database
  console.log("Initializing database...")
  const db = initDatabase(dbPath)

  // Get all sessions
  console.log("Scanning sessions...")
  const sessionFiles = getSessionFiles(storageRoot)
  console.log(`Found ${sessionFiles.length} sessions`)
  console.log()

  // Migration stats
  let stats: MigrationStats = {
    sessionsTotal: sessionFiles.length,
    sessionsProcessed: 0,
    sessionsSkipped: 0,
    messagesProcessed: 0,
    messagesSkipped: 0,
    toolCallsProcessed: 0,
    toolCallsSkipped: 0,
    errors: 0
  }

  // Process each session
  const startTime = Date.now()
  
  for (let i = 0; i < sessionFiles.length; i++) {
    const sessionFile = sessionFiles[i]
    
    if (i % 10 === 0 || i === sessionFiles.length - 1) {
      process.stdout.write(`\rProgress: ${i + 1}/${sessionFiles.length} sessions (${((i + 1) / sessionFiles.length * 100).toFixed(1)}%)`)
    }

    stats = migrateSessionData(db, sessionFile, storageRoot, stats)
  }

  console.log() // New line after progress
  console.log()

  // Summary
  const duration = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log("=".repeat(60))
  console.log("Migration Complete!")
  console.log("=".repeat(60))
  console.log()
  console.log(`Duration: ${duration}s`)
  console.log()
  console.log("Sessions:")
  console.log(`  Processed: ${stats.sessionsProcessed}`)
  console.log(`  Skipped (already exists): ${stats.sessionsSkipped}`)
  console.log()
  console.log("Messages:")
  console.log(`  Processed: ${stats.messagesProcessed}`)
  console.log(`  Skipped (already exists): ${stats.messagesSkipped}`)
  console.log()
  console.log("Tool Calls:")
  console.log(`  Processed: ${stats.toolCallsProcessed}`)
  console.log(`  Skipped (already exists): ${stats.toolCallsSkipped}`)
  console.log()
  
  if (stats.errors > 0) {
    console.log(`Errors: ${stats.errors} (check plugin_errors table for details)`)
    console.log()
  }

  db.close()
  console.log("Migration finished successfully!")
}

// Run if called directly
if (import.meta.main) {
  runMigration().catch((err) => {
    console.error("Migration failed:", err)
    process.exit(1)
  })
}

export { runMigration }
