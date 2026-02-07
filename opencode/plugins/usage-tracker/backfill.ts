import type { Database } from "bun:sqlite"
import type {
  Session,
  AssistantMessage,
  UserMessage,
  TextPart,
  ToolPart,
} from "@opencode-ai/sdk"
import type { createOpencodeClient } from "@opencode-ai/sdk"
import type { PluginState } from "./types"
import { logError } from "./utils"

export const backfillExistingSessions = async (
  db: Database,
  client: ReturnType<typeof createOpencodeClient>,
  directory: string,
  worktree: string,
  state: PluginState
): Promise<PluginState> => {
  try {
    // Get the last updated_at timestamp from our DB
    const lastUpdated = db.prepare("SELECT MAX(updated_at) as max_updated FROM sessions").get() as {
      max_updated: number | null
    }
    const cutoffTime = lastUpdated?.max_updated ?? 0

    const sessionsResult = await client.session.list()
    if (!sessionsResult.data) return state

    // Filter to only sessions updated after our cutoff
    const sessions = sessionsResult.data.filter((s) => s.time.updated > cutoffTime)
    if (sessions.length === 0) return state

    // Build session parent ID map from all sessions
    let newState = state
    for (const session of sessionsResult.data) {
      newState = {
        ...newState,
        sessionParentIDs: new Map(newState.sessionParentIDs).set(session.id, session.parentID ?? null),
      }
    }

    // Process main sessions first, then subagents
    const mainSessions = sessions.filter((s) => !s.parentID)
    const subagentSessions = sessions.filter((s) => s.parentID)

    for (const session of mainSessions) {
      newState = await backfillSession(db, client, session, directory, worktree, null, newState)
    }

    for (const session of subagentSessions) {
      const parentTurnID = db
        .prepare(`SELECT id FROM turns WHERE session_id = ? AND started_at <= ? ORDER BY started_at DESC LIMIT 1`)
        .get(session.parentID, session.time.created) as { id: string } | undefined

      if (parentTurnID) {
        newState = {
          ...newState,
          sessionToParentTurn: new Map(newState.sessionToParentTurn).set(session.id, parentTurnID.id),
        }
      }

      newState = await backfillSession(db, client, session, directory, worktree, parentTurnID?.id ?? null, newState)
    }

    return newState
  } catch (err) {
    logError(db, "backfill", { directory, worktree }, err)
    return state
  }
}

const backfillSession = async (
  db: Database,
  client: ReturnType<typeof createOpencodeClient>,
  session: Session,
  directory: string,
  worktree: string,
  parentTurnID: string | null,
  state: PluginState
): Promise<PluginState> => {
  try {
    // Upsert session
    db.prepare(`
      INSERT INTO sessions (id, title, parent_id, project_path, worktree, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET title = ?, parent_id = ?, updated_at = ?
    `).run(
      session.id,
      session.title ?? null,
      session.parentID ?? null,
      directory,
      worktree,
      session.time.created,
      session.time.updated,
      session.title ?? null,
      session.parentID ?? null,
      session.time.updated
    )

    const messagesResult = await client.session.messages({ path: { id: session.id } })
    if (!messagesResult.data) return state

    let currentTurnID: string | null = parentTurnID
    let newState = state

    for (const { info: message, parts } of messagesResult.data) {
      const textContent = parts
        .filter((p): p is TextPart => p.type === "text")
        .map((p) => p.text)
        .join("")

      let agent: string | null = null
      let isSubagentPrompt = 0

      if (message.role === "user") {
        const userMsg = message as UserMessage
        agent = userMsg.agent ?? null
        isSubagentPrompt = session.parentID ? 1 : 0

        if (!isSubagentPrompt) {
          currentTurnID = userMsg.id
          db.prepare(`
            INSERT INTO turns (id, session_id, parent_turn_id, user_message, started_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET user_message = COALESCE(turns.user_message, ?)
          `).run(currentTurnID, session.id, null, textContent || null, userMsg.time.created, textContent || null)
        }
      }

      if (message.role === "assistant") {
        const msg = message as AssistantMessage
        db.prepare(`
          INSERT INTO messages (
            id, session_id, turn_id, role, model_id, provider_id,
            created_at, completed_at, input_tokens, output_tokens, reasoning_tokens,
            cache_read_tokens, cache_write_tokens, cost, finish_reason, content
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            content = COALESCE(NULLIF(messages.content, ''), ?),
            turn_id = COALESCE(messages.turn_id, ?)
        `).run(
          msg.id,
          msg.sessionID,
          currentTurnID,
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
          msg.finish ?? null,
          textContent || null,
          textContent || null,
          currentTurnID
        )
      } else {
        const msg = message as UserMessage
        db.prepare(`
          INSERT INTO messages (
            id, session_id, turn_id, role, agent, is_subagent_prompt, model_id, provider_id, created_at, content
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            content = COALESCE(NULLIF(messages.content, ''), ?),
            agent = COALESCE(messages.agent, ?),
            turn_id = COALESCE(messages.turn_id, ?)
        `).run(
          msg.id,
          msg.sessionID,
          currentTurnID,
          msg.role,
          agent,
          isSubagentPrompt,
          msg.model?.modelID ?? null,
          msg.model?.providerID ?? null,
          msg.time.created,
          textContent || null,
          textContent || null,
          agent,
          currentTurnID
        )
      }

      // Process tool parts
      for (const part of parts) {
        if (part.type === "tool") {
          const toolPart = part as ToolPart
          if (toolPart.state.status === "completed") {
            const toolState = toolPart.state
            db.prepare(`
              INSERT INTO tool_calls (
                id, session_id, turn_id, message_id, tool_name, args_json,
                started_at, completed_at, duration_ms, success, output_metadata
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
              ON CONFLICT(id) DO UPDATE SET turn_id = COALESCE(tool_calls.turn_id, ?)
            `).run(
              toolPart.callID,
              toolPart.sessionID,
              currentTurnID,
              toolPart.messageID,
              toolPart.tool,
              JSON.stringify(toolState.input),
              toolState.time.start,
              toolState.time.end,
              toolState.time.end - toolState.time.start,
              JSON.stringify(toolState.metadata),
              currentTurnID
            )
          } else if (toolPart.state.status === "error") {
            const toolState = toolPart.state
            db.prepare(`
              INSERT INTO tool_calls (
                id, session_id, turn_id, message_id, tool_name, args_json,
                started_at, completed_at, duration_ms, success, error_message, output_metadata
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
              ON CONFLICT(id) DO UPDATE SET turn_id = COALESCE(tool_calls.turn_id, ?)
            `).run(
              toolPart.callID,
              toolPart.sessionID,
              currentTurnID,
              toolPart.messageID,
              toolPart.tool,
              JSON.stringify(toolState.input),
              toolState.time.start,
              toolState.time.end,
              toolState.time.end - toolState.time.start,
              toolState.error,
              JSON.stringify(toolState.metadata ?? {}),
              currentTurnID
            )
          }
        }
      }
    }

    return newState
  } catch (err) {
    logError(db, "backfill.session", { sessionId: session.id, directory, worktree }, err)
    return state
  }
}
