import type { Database } from "bun:sqlite"
import { existsSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"

export const expandPath = (path: string): string =>
  path.startsWith("~/") ? path.replace("~", process.env.HOME || "") : path

export const ensureDirectoryExists = (filePath: string): void => {
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

export const logError = (
  db: Database,
  eventType: string | undefined,
  eventData: unknown,
  error: unknown
): void => {
  try {
    db.prepare(`
      INSERT INTO plugin_errors (timestamp, event_type, event_data, error_message, stack_trace)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      Date.now(),
      eventType ?? "unknown",
      JSON.stringify(eventData, null, 2),
      error instanceof Error ? error.message : String(error),
      error instanceof Error ? error.stack ?? "" : ""
    )
  } catch {
    // Silently continue if error logging fails
  }
}
