import type { Database } from "bun:sqlite"
import type { PluginState } from "../types"
import { getCurrentTurnID } from "../state"
import { logError } from "../utils"

export const onToolExecuteBefore = (
  db: Database,
  state: PluginState,
  callID: string,
  sessionID: string,
  toolName: string,
  args: unknown
): PluginState => {
  try {
    const now = Date.now()
    const turnID = getCurrentTurnID(state, sessionID)

    db.prepare(`
      INSERT OR REPLACE INTO tool_calls (id, session_id, turn_id, tool_name, args_json, started_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(callID, sessionID, turnID, toolName, JSON.stringify(args), now)

    return {
      ...state,
      pendingToolCalls: new Map(state.pendingToolCalls).set(callID, {
        startedAt: now,
        sessionID,
        toolName,
        args,
        turnID: turnID ?? undefined,
      }),
    }
  } catch (err) {
    logError(db, "tool.execute.before", { callID, sessionID, toolName, args }, err)
    return state
  }
}
