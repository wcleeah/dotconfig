import type { Plugin } from "@opencode-ai/plugin"
import type { Database } from "bun:sqlite"
import path from "path"
import fs from "fs/promises"
import { existsSync } from "fs"

import { initDatabase } from "./usage-tracker/schema"
import { logError } from "./usage-tracker/utils"

enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

interface MigrationStats {
  projectsFound: number
  projectsMigrated: number
  sessionsFound: number
  sessionsMigrated: number
  turnsFound: number
  turnsMigrated: number
  messagesFound: number
  messagesMigrated: number
  partsFound: number
  partsMigrated: number
  errors: number
  duration: number
  startTime: number
  endTime: number
}

interface Project {
  id: string
  worktree: string
  vcs: string
  time: { created: number; initialized: number }
}

interface Session {
  id: string
  slug: string
  projectID: string
  directory: string
  parentID?: string
  title: string
  time: { created: number; updated: number; compacting?: number; archived?: number }
}

interface Message {
  id: string
  sessionID: string
  role: string
  time: { created: number; completed?: number }
  parentID?: string
  agent?: string
  model?: { providerID: string; modelID: string }
  cost?: number
  tokens?: {
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
  finish?: string
}

interface Part {
  id: string
  sessionID: string
  messageID: string
  type: string
  [key: string]: unknown
}

class MigrationLogger {
  private logLevel: LogLevel
  private startTime: number

  constructor() {
    this.startTime = Date.now()
    this.logLevel = process.env.DEBUG ? LogLevel.DEBUG : LogLevel.INFO
  }

  private formatTimestamp(): string {
    return new Date().toISOString()
  }

  private formatElapsed(): string {
    const elapsed = Date.now() - this.startTime
    if (elapsed < 1000) return `${elapsed}ms`
    if (elapsed < 60000) return `${(elapsed / 1000).toFixed(1)}s`
    return `${(elapsed / 60000).toFixed(1)}m`
  }

  private formatMessage(level: string, message: string, data?: Record<string, unknown>): string {
    const timestamp = this.formatTimestamp()
    const elapsed = this.formatElapsed()
    const dataStr = data ? ` | ${JSON.stringify(data)}` : ""
    return `[${level}] [${elapsed}] ${message}${dataStr}`
  }

  debug(message: string, data?: Record<string, unknown>): void {
    if (this.logLevel <= LogLevel.DEBUG) {
      console.log(this.formatMessage("DEBUG", message, data))
    }
  }

  info(message: string, data?: Record<string, unknown>): void {
    if (this.logLevel <= LogLevel.INFO) {
      console.log(this.formatMessage("INFO", message, data))
    }
  }

  warn(message: string, data?: Record<string, unknown>): void {
    if (this.logLevel <= LogLevel.WARN) {
      console.log(this.formatMessage("WARN", message, data))
    }
  }

  error(message: string, error?: Error): void {
    if (this.logLevel <= LogLevel.ERROR) {
      const data: Record<string, unknown> = {}
      if (error) {
        data.error = error.message
        data.stack = error.stack
      }
      console.log(this.formatMessage("ERROR", message, data))
    }
  }

  phase(phase: string, status: string): void {
    console.log(this.formatMessage("INFO", `Phase: ${phase} - ${status}`))
  }

  progress(
    phase: string,
    current: number,
    total: number,
    currentItem?: string
  ): void {
    const percentage = total > 0 ? Math.round((current / total) * 100) : 0
    const barWidth = 20
    const filledWidth = Math.round((barWidth * current) / total)
    const bar = "=".repeat(filledWidth) + "-".repeat(barWidth - filledWidth)
    const elapsed = this.formatElapsed()
    const itemStr = currentItem ? ` | ${currentItem}` : ""
    console.log(
      this.formatMessage(
        "INFO",
        `[${bar}] ${percentage}% | ${current}/${total} | ${elapsed}${itemStr}`
      )
    )
  }

  summary(stats: MigrationStats): void {
    console.log("")
    console.log(this.formatMessage("INFO", "=".repeat(60)))
    console.log(this.formatMessage("INFO", "Migration Complete!"))
    console.log(this.formatMessage("INFO", `Duration: ${(stats.duration / 1000).toFixed(2)}s`))
    console.log(this.formatMessage("INFO", `Projects: ${stats.projectsMigrated}/${stats.projectsFound}`))
    console.log(this.formatMessage("INFO", `Sessions: ${stats.sessionsMigrated}/${stats.sessionsFound}`))
    console.log(this.formatMessage("INFO", `Turns: ${stats.turnsMigrated}/${stats.turnsFound}`))
    console.log(this.formatMessage("INFO", `Messages: ${stats.messagesMigrated}/${stats.messagesFound}`))
    console.log(this.formatMessage("INFO", `Parts: ${stats.partsMigrated}/${stats.partsFound}`))
    console.log(this.formatMessage("INFO", `Errors: ${stats.errors}`))
    console.log(this.formatMessage("INFO", "=".repeat(60)))
  }
}

class ProgressBar {
  private total: number = 0
  private current: number = 0
  private lastRenderTime: number = 0
  private renderInterval: number = 100
  private label: string = ""
  private width: number = 30

  constructor(label: string = "Progress") {
    this.label = label
  }

  setTotal(total: number): void {
    this.total = total
    this.current = 0
  }

  update(current: number, currentItem?: string): void {
    this.current = current
    const now = Date.now()
    if (now - this.lastRenderTime > this.renderInterval || current >= this.total) {
      this.render(currentItem)
      this.lastRenderTime = now
    }
  }

  increment(currentItem?: string): void {
    this.update(this.current + 1, currentItem)
  }

  private render(currentItem?: string): void {
    if (this.total === 0) {
      process.stdout.write(`\r${this.label}: Determining total items...\n`)
      return
    }

    const percentage = Math.min(100, Math.round((this.current / this.total) * 100))
    const filledWidth = Math.max(0, Math.min(this.width, Math.round((this.width * this.current) / this.total)))
    const emptyWidth = Math.max(0, this.width - filledWidth)
    const bar = "█".repeat(filledWidth) + "░".repeat(emptyWidth)
    const itemStr = currentItem ? ` | ${currentItem}` : ""

    process.stdout.write(
      `\r${this.label}: [${bar}] ${percentage}% | ${this.current}/${this.total}${itemStr}   `
    )
  }

  complete(finalItem?: string): void {
    this.render(finalItem)
    process.stdout.write("\n")
  }
}

const DEFAULT_DB_PATH = `${process.env.HOME}/.config/opencode/usage.db`
const STORAGE_SUBDIR = "storage"

function getStorageDir(): string {
  let storageDir = path.join(process.env.XDG_DATA_HOME || path.join(process.env.HOME, ".local/share"), "opencode", STORAGE_SUBDIR)

  if (!existsSync(storageDir)) {
    storageDir = path.join(process.env.HOME, ".local/share/opencode", STORAGE_SUBDIR)
  }

  if (!existsSync(storageDir)) {
    storageDir = path.join(process.env.HOME, ".local/state/opencode", STORAGE_SUBDIR)
  }

  return storageDir
}

async function scanProjects(storageDir: string): Promise<Project[]> {
  const projectsDir = path.join(storageDir, "project")
  if (!existsSync(projectsDir)) {
    return []
  }

  const files = await fs.readdir(projectsDir)
  const projects: Project[] = []

  for (const file of files) {
    if (!file.endsWith(".json")) continue

    const filePath = path.join(projectsDir, file)
    try {
      const content = await fs.readFile(filePath, "utf-8")
      const project = JSON.parse(content) as Project
      projects.push(project)
    } catch (error) {
      console.error(`Failed to read project file: ${filePath}`, error)
    }
  }

  return projects
}

async function scanSessions(storageDir: string, projectID: string): Promise<Session[]> {
  const sessionsDir = path.join(storageDir, "session", projectID)
  if (!existsSync(sessionsDir)) {
    return []
  }

  const files = await fs.readdir(sessionsDir)
  const sessions: Session[] = []

  for (const file of files) {
    if (!file.endsWith(".json")) continue

    const filePath = path.join(sessionsDir, file)
    try {
      const content = await fs.readFile(filePath, "utf-8")
      const session = JSON.parse(content) as Session
      sessions.push(session)
    } catch (error) {
      console.error(`Failed to read session file: ${filePath}`, error)
    }
  }

  return sessions
}

async function scanMessages(storageDir: string, sessionID: string): Promise<Message[]> {
  const messagesDir = path.join(storageDir, "message", sessionID)
  if (!existsSync(messagesDir)) {
    return []
  }

  const files = await fs.readdir(messagesDir)
  const messages: Message[] = []

  for (const file of files) {
    if (!file.endsWith(".json")) continue

    const filePath = path.join(messagesDir, file)
    try {
      const content = await fs.readFile(filePath, "utf-8")
      const message = JSON.parse(content) as Message
      messages.push(message)
    } catch (error) {
      console.error(`Failed to read message file: ${filePath}`, error)
    }
  }

  messages.sort((a, b) => a.time.created - b.time.created)

  return messages
}

async function scanParts(storageDir: string, messageID: string): Promise<Part[]> {
  const partsDir = path.join(storageDir, "part", messageID)
  if (!existsSync(partsDir)) {
    return []
  }

  const files = await fs.readdir(partsDir)
  const parts: Part[] = []

  for (const file of files) {
    if (!file.endsWith(".json")) continue

    const filePath = path.join(partsDir, file)
    try {
      const content = await fs.readFile(filePath, "utf-8")
      const part = JSON.parse(content) as Part
      parts.push(part)
    } catch (error) {
      console.error(`Failed to read part file: ${filePath}`, error)
    }
  }

  return parts
}

async function extractMessageContent(
  storageDir: string,
  messageID: string
): Promise<string | null> {
  const parts = await scanParts(storageDir, messageID)

  if (parts.length === 0) {
    return null
  }

  return parts.map((part) => JSON.stringify(part)).join("\n")
}

function findParentTurnID(db: Database, parentSessionID: string, sessionCreatedAt: number): string | null {
  try {
    const result = db
      .prepare(
        `SELECT id FROM turns WHERE session_id = ? AND started_at <= ? ORDER BY started_at DESC LIMIT 1`
      )
      .get(parentSessionID, sessionCreatedAt) as { id: string } | undefined

    return result?.id || null
  } catch {
    return null
  }
}

async function getSessionParentTurnID(
  db: Database,
  storageDir: string,
  parentSessionID: string,
  sessionCreatedAt: number
): Promise<string | null> {
  const parentSession = findParentTurnID(db, parentSessionID, sessionCreatedAt)
  return parentSession
}

export const UsageTrackerMigrationPlugin: Plugin = async () => {
  if (!process.env.OPENCODE_RUN_MIGRATIONS) {
    return {}
  }

  const logger = new MigrationLogger()
  const dbPath = process.env.OPENCODE_USAGE_DB || DEFAULT_DB_PATH
  const storageDir = getStorageDir()

  logger.info("Starting usage tracker migration...")
  logger.info(`Storage directory: ${storageDir}`)
  logger.info(`Database path: ${dbPath}`)

  const stats: MigrationStats = {
    projectsFound: 0,
    projectsMigrated: 0,
    sessionsFound: 0,
    sessionsMigrated: 0,
    turnsFound: 0,
    turnsMigrated: 0,
    messagesFound: 0,
    messagesMigrated: 0,
    partsFound: 0,
    partsMigrated: 0,
    errors: 0,
    duration: 0,
    startTime: Date.now(),
    endTime: 0,
  }

  try {
    const db = initDatabase(dbPath)

    logger.phase("Discovery", "Scanning for projects...")
    const projects = await scanProjects(storageDir)
    stats.projectsFound = projects.length
    logger.info(`Found ${projects.length} projects`)

    const projectProgress = new ProgressBar("Projects")
    const sessionProgress = new ProgressBar("Sessions")
    const turnProgress = new ProgressBar("Turns")
    const messageProgress = new ProgressBar("Messages")
    const partProgress = new ProgressBar("Parts")

    let totalSessions = 0
    let totalTurns = 0
    let totalMessages = 0
    let totalParts = 0

    for (const project of projects) {
      const sessions = await scanSessions(storageDir, project.id)
      stats.sessionsFound += sessions.length
      totalSessions += sessions.length

      for (const session of sessions) {
        const messages = await scanMessages(storageDir, session.id)
        stats.messagesFound += messages.length
        totalMessages += messages.length

        for (const message of messages) {
          if (message.role === "user") {
            totalTurns++
          }

          const parts = await scanParts(storageDir, message.id)
          stats.partsFound += parts.length
          totalParts += parts.length
        }
      }
    }

    logger.info(`Total items to migrate:`)
    logger.info(`  Sessions: ${totalSessions}`)
    logger.info(`  Turns: ${totalTurns}`)
    logger.info(`  Messages: ${totalMessages}`)
    logger.info(`  Parts: ${totalParts}`)

    projectProgress.setTotal(projects.length)
    sessionProgress.setTotal(totalSessions)
    turnProgress.setTotal(totalTurns)
    messageProgress.setTotal(totalMessages)
    partProgress.setTotal(totalParts)

    let sessionCount = 0
    let turnCount = 0
    let messageCount = 0
    let partCount = 0

    for (const project of projects) {
      logger.phase("Migration", `Processing project ${project.id}...`)
      projectProgress.update(stats.projectsMigrated + 1, project.id)

      const sessions = await scanSessions(storageDir, project.id)

      const mainSessions = sessions.filter(s => !s.parentID)
      const subagentSessions = sessions.filter(s => s.parentID)

      for (const session of mainSessions) {
        sessionCount++
        sessionProgress.update(sessionCount, session.title)

        try {
          db.prepare(`
            INSERT OR REPLACE INTO sessions (id, title, parent_id, project_path, worktree, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(
            session.id,
            session.title,
            session.parentID || null,
            session.directory,
            project.worktree,
            session.time.created,
            session.time.updated
          )
          stats.sessionsMigrated++
        } catch (error) {
          stats.errors++
          logger.error(`Failed to insert session ${session.id}`, error as Error)
          logError(db, "migration.session", { sessionID: session.id }, error)
        }

        const messages = await scanMessages(storageDir, session.id)
        let currentTurnID: string | null = null
        let previousTurnID: string | null = null

        for (const message of messages) {
          messageCount++
          messageProgress.update(messageCount, `${message.role} message`)

          try {
            const messageContent = await extractMessageContent(storageDir, message.id)

            if (message.role === "user") {
              previousTurnID = currentTurnID

              if (previousTurnID) {
                try {
                  db.prepare(`UPDATE turns SET ended_at = ? WHERE id = ?`).run(message.time.created, previousTurnID)
                } catch (error) {
                  logger.error(`Failed to end previous turn ${previousTurnID}`, error as Error)
                }
              }

              currentTurnID = message.id

              try {
                db.prepare(`
                  INSERT INTO turns (id, session_id, parent_turn_id, user_message, started_at)
                  VALUES (?, ?, ?, ?, ?)
                  ON CONFLICT(id) DO UPDATE SET user_message = COALESCE(turns.user_message, ?)
                `).run(
                  currentTurnID,
                  session.id,
                  null,
                  messageContent || null,
                  message.time.created,
                  messageContent || null
                )
                stats.turnsMigrated++
                turnCount++
                turnProgress.increment(currentTurnID)
              } catch (error) {
                stats.errors++
                logger.error(`Failed to insert turn ${currentTurnID}`, error as Error)
                logError(db, "migration.turn", { turnID: currentTurnID }, error)
              }
            }

            db.prepare(`
              INSERT INTO messages (
                id, session_id, turn_id, role, agent, content, is_subagent_prompt, model_id, provider_id,
                created_at, completed_at, input_tokens, output_tokens,
                reasoning_tokens, cache_read_tokens, cache_write_tokens, cost, finish_reason
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                content = COALESCE(NULLIF(messages.content, ''), ?),
                turn_id = COALESCE(messages.turn_id, ?)
            `).run(
              message.id,
              message.sessionID,
              currentTurnID,
              message.role,
              message.agent || null,
              messageContent || null,
              0,
              message.model?.modelID || null,
              message.model?.providerID || null,
              message.time.created,
              message.time.completed || null,
              message.tokens?.input || null,
              message.tokens?.output || null,
              message.tokens?.reasoning || null,
              message.tokens?.cache?.read || null,
              message.tokens?.cache?.write || null,
              message.cost || null,
              message.finish || null,
              messageContent || null,
              currentTurnID
            )
            stats.messagesMigrated++
          } catch (error) {
            stats.errors++
            logger.error(`Failed to insert message ${message.id}`, error as Error)
            logError(db, "migration.message", { messageID: message.id }, error)
          }

          const parts = await scanParts(storageDir, message.id)
          let partIndex = 0

          for (const part of parts) {
            partCount++
            partProgress.update(partCount, `${part.type} part`)

            try {
              db.prepare(`
                INSERT OR REPLACE INTO parts (id, message_id, session_id, part_index, type, data, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
              `).run(
                part.id,
                part.messageID,
                part.sessionID,
                partIndex++,
                part.type,
                JSON.stringify(part),
                Date.now()
              )
              stats.partsMigrated++
            } catch (error) {
              stats.errors++
              logger.error(`Failed to insert part ${part.id}`, error as Error)
              logError(db, "migration.part", { partID: part.id }, error)
            }
          }
        }

        try {
          db.prepare(`UPDATE sessions SET ended_at = ? WHERE id = ?`).run(Date.now(), session.id)
        } catch (error) {
          logger.error(`Failed to update session end time ${session.id}`, error as Error)
        }

        if (currentTurnID) {
          try {
            db.prepare(`UPDATE turns SET ended_at = ? WHERE id = ?`).run(Date.now(), currentTurnID)
          } catch (error) {
            logger.error(`Failed to end final turn ${currentTurnID}`, error as Error)
          }
        }
      }

      for (const session of subagentSessions) {
        sessionCount++
        sessionProgress.update(sessionCount, session.title)

        try {
          const parentTurnID = await getSessionParentTurnID(db, storageDir, session.parentID!, session.time.created)

          db.prepare(`
            INSERT OR REPLACE INTO sessions (id, title, parent_id, project_path, worktree, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(
            session.id,
            session.title,
            session.parentID || null,
            session.directory,
            project.worktree,
            session.time.created,
            session.time.updated
          )
          stats.sessionsMigrated++
        } catch (error) {
          stats.errors++
          logger.error(`Failed to insert session ${session.id}`, error as Error)
          logError(db, "migration.session", { sessionID: session.id }, error)
        }

        const messages = await scanMessages(storageDir, session.id)
        let currentTurnID: string | null = null

        for (const message of messages) {
          messageCount++
          messageProgress.update(messageCount, `${message.role} message`)

          try {
            const messageContent = await extractMessageContent(storageDir, message.id)

            if (message.role === "user") {
              currentTurnID = message.id

              try {
                db.prepare(`
                  INSERT INTO turns (id, session_id, parent_turn_id, user_message, started_at)
                  VALUES (?, ?, ?, ?, ?)
                  ON CONFLICT(id) DO UPDATE SET user_message = COALESCE(turns.user_message, ?)
                `).run(
                  currentTurnID,
                  session.id,
                  null,
                  messageContent || null,
                  message.time.created,
                  messageContent || null
                )
                stats.turnsMigrated++
                turnCount++
                turnProgress.increment(currentTurnID)
              } catch (error) {
                stats.errors++
                logger.error(`Failed to insert turn ${currentTurnID}`, error as Error)
                logError(db, "migration.turn", { turnID: currentTurnID }, error)
              }
            }

            db.prepare(`
              INSERT INTO messages (
                id, session_id, turn_id, role, agent, content, is_subagent_prompt, model_id, provider_id,
                created_at, completed_at, input_tokens, output_tokens,
                reasoning_tokens, cache_read_tokens, cache_write_tokens, cost, finish_reason
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                content = COALESCE(NULLIF(messages.content, ''), ?),
                turn_id = COALESCE(messages.turn_id, ?)
            `).run(
              message.id,
              message.sessionID,
              currentTurnID,
              message.role,
              message.agent || null,
              messageContent || null,
              1,
              message.model?.modelID || null,
              message.model?.providerID || null,
              message.time.created,
              message.time.completed || null,
              message.tokens?.input || null,
              message.tokens?.output || null,
              message.tokens?.reasoning || null,
              message.tokens?.cache?.read || null,
              message.tokens?.cache?.write || null,
              message.cost || null,
              message.finish || null,
              messageContent || null,
              currentTurnID
            )
            stats.messagesMigrated++
          } catch (error) {
            stats.errors++
            logger.error(`Failed to insert message ${message.id}`, error as Error)
            logError(db, "migration.message", { messageID: message.id }, error)
          }

          const parts = await scanParts(storageDir, message.id)
          let partIndex = 0

          for (const part of parts) {
            partCount++
            partProgress.update(partCount, `${part.type} part`)

            try {
              db.prepare(`
                INSERT OR REPLACE INTO parts (id, message_id, session_id, part_index, type, data, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
              `).run(
                part.id,
                part.messageID,
                part.sessionID,
                partIndex++,
                part.type,
                JSON.stringify(part),
                Date.now()
              )
              stats.partsMigrated++
            } catch (error) {
              stats.errors++
              logger.error(`Failed to insert part ${part.id}`, error as Error)
              logError(db, "migration.part", { partID: part.id }, error)
            }
          }
        }

        try {
          db.prepare(`UPDATE sessions SET ended_at = ? WHERE id = ?`).run(Date.now(), session.id)
        } catch (error) {
          logger.error(`Failed to update session end time ${session.id}`, error as Error)
        }

        if (currentTurnID) {
          try {
            db.prepare(`UPDATE turns SET ended_at = ? WHERE id = ?`).run(Date.now(), currentTurnID)
          } catch (error) {
            logger.error(`Failed to end final turn ${currentTurnID}`, error as Error)
          }
        }
      }

      stats.projectsMigrated++
    }

    projectProgress.complete(`${stats.projectsMigrated}/${stats.projectsFound} projects`)
    sessionProgress.complete(`${stats.sessionsMigrated}/${stats.sessionsFound} sessions`)
    turnProgress.complete(`${stats.turnsMigrated}/${stats.turnsFound} turns`)
    messageProgress.complete(`${stats.messagesMigrated}/${stats.messagesFound} messages`)
    partProgress.complete(`${stats.partsMigrated}/${stats.partsFound} parts`)

    stats.endTime = Date.now()
    stats.duration = stats.endTime - stats.startTime

    logger.summary(stats)

    db.close()

    return {}
  } catch (error) {
    stats.endTime = Date.now()
    stats.duration = stats.endTime - stats.startTime
    stats.errors++
    logger.error("Fatal migration error", error as Error)
    throw error
  }
}
