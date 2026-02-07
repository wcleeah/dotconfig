import type { Database } from "bun:sqlite"
import type { ToolPart, CompactionPart } from "@opencode-ai/sdk"
import type { PluginState } from "../types"
import { logError } from "../utils"

export const onToolPart = (
  db: Database,
  state: PluginState,
  part: ToolPart
): PluginState => {
  try {
    // Skip if session is being compacted
    if (state.compactingSessions.has(part.sessionID)) {
      return state
    }

    if (part.state.status === "running" || part.state.status === "pending") {
      db.prepare(`UPDATE tool_calls SET message_id = ? WHERE id = ?`).run(part.messageID, part.callID)
      return state
    }

    if (part.state.status === "completed") {
      const pending = state.pendingToolCalls.get(part.callID)
      if (!pending) return state

      const now = Date.now()

      db.prepare(`
        UPDATE tool_calls SET
          message_id = ?, completed_at = ?, duration_ms = ?, success = 1, output_metadata = ?
        WHERE id = ?
      `).run(part.messageID, now, now - pending.startedAt, JSON.stringify(part.state.metadata), part.callID)

      const newPendingToolCalls = new Map(state.pendingToolCalls)
      newPendingToolCalls.delete(part.callID)
      return { ...state, pendingToolCalls: newPendingToolCalls }
    }

    if (part.state.status === "error") {
      const pending = state.pendingToolCalls.get(part.callID)
      if (!pending) return state

      const now = Date.now()

      db.prepare(`
        UPDATE tool_calls SET
          message_id = ?, completed_at = ?, duration_ms = ?, success = 0, error_message = ?, output_metadata = ?
        WHERE id = ?
      `).run(
        part.messageID,
        now,
        now - pending.startedAt,
        part.state.error,
        JSON.stringify(part.state.metadata ?? {}),
        part.callID
      )

      const newPendingToolCalls = new Map(state.pendingToolCalls)
      newPendingToolCalls.delete(part.callID)
      return { ...state, pendingToolCalls: newPendingToolCalls }
    }

    return state
  } catch (err) {
    logError(db, "message.part.updated.tool", part, err)
    return state
  }
}

export const onCompactionPart = (
  db: Database,
  state: PluginState,
  part: CompactionPart
): PluginState => {
  try {
    // Update the compactions table with completion info
    const compactionID = state.compactingSessions.get(part.sessionID)
    if (compactionID) {
      db.prepare(`
        UPDATE compactions SET completed_at = ? WHERE id = ?
      `).run(Date.now(), compactionID)
    }

    // Create an assistant message for the compaction
    // Use REPLACE to update if already exists from compaction hook
    db.prepare(`
      INSERT OR REPLACE INTO messages (
        id, session_id, turn_id, role, agent, content, model_id, provider_id,
        created_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      part.messageID,
      part.sessionID,
      null,
      "assistant",
      "compaction",
      `[Context compacted. Auto: ${part.auto}]`,
      null,
      null,
      Date.now(),
      Date.now()
    )

    return state
  } catch (err) {
    logError(db, "message.part.updated.compaction", part, err)
    return state
  }
}
