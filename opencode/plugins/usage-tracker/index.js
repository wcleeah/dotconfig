import { tool } from "@opencode-ai/plugin"
import { Database } from "bun:sqlite"

import { buildResponse, buildToolCall, createTrackerState, mergeTurnRows, rememberSessionProject } from "./normalize.js"
import { createIngestionQueue } from "./queue.js"
import { textValue } from "./utils.js"

/**
 * Resolves the OpenCode SQLite database path used for tracker hydration.
 *
 * @returns {string}
 */
function getOpenCodeDbPath() {
  return process.env.OPENCODE_DB || `${process.env.XDG_DATA_HOME || `${process.env.HOME}/.local/share`}/opencode/opencode.db`
}

/**
 * Hydrates session ancestry and project ownership from the OpenCode database.
 *
 * This lets the tracker resolve session lineage before it has seen all session
 * lifecycle events during the current process lifetime.
 *
 * @param {import("./index").TrackerState} state
 * @returns {Promise<void>}
 */
async function hydrateStateFromOpenCodeDb(state) {
  let db
  try {
    db = new Database(getOpenCodeDbPath(), { readonly: true })
    const sessions = db
      .query("SELECT id, project_id, parent_id, time_created FROM session ORDER BY time_created, id")
      .all()
    for (const row of sessions) {
      rememberSessionProject(state, {
        id: row.id,
        projectID: row.project_id,
        parentID: row.parent_id,
      })
    }

    const messages = db
      .query("SELECT id, session_id, time_created, data FROM message ORDER BY time_created, id")
      .all()
      .map((row) => ({
        id: String(row.id),
        sessionID: String(row.session_id),
        timeCreated: Number(row.time_created),
        data: JSON.parse(String(row.data)),
      }))
    const partsByMessage = new Map()
    const parts = db
      .query("SELECT id, message_id, session_id, time_created, data FROM part ORDER BY time_created, id")
      .all()
      .map((row) => ({
        id: String(row.id),
        messageID: String(row.message_id),
        sessionID: String(row.session_id),
        timeCreated: Number(row.time_created),
        data: JSON.parse(String(row.data)),
      }))

    for (const part of parts) {
      const bucket = partsByMessage.get(part.messageID) ?? []
      bucket.push(part)
      partsByMessage.set(part.messageID, bucket)
    }

    for (const message of messages) {
      const info = message.data
      const sessionID = message.sessionID
      const projectID = state.sessionProjectMap.get(sessionID) ?? state.projectID ?? "_unknown"
      const rootSessionID = state.rootSessionMap.get(sessionID) ?? sessionID
      const role = String(info.role ?? "")
      if (role) state.messageRoleMap.set(message.id, role)

      if (role === "user") {
        const createdAt = Number(info.time?.created ?? message.timeCreated)
        state.turnCreatedMap.set(message.id, createdAt)
        state.turnRowMap.set(
          message.id,
          mergeTurnRows(state.turnRowMap.get(message.id), {
            id: message.id,
            session_id: sessionID,
            root_session_id: rootSessionID,
            project_id: projectID,
            content: null,
            synthetic: 0,
            compaction: 0,
            undone_at: null,
            time_created: createdAt,
            time_updated: createdAt,
            turn_duration_ms: null,
          }),
        )
      }

      if (role === "assistant") {
        const response = buildResponse({ id: message.id, parentID: info.parentID, sessionID, ...info }, rootSessionID, projectID)
        state.responseMap.set(message.id, response)
        const completedAt = info.time?.completed
        const turnID = info.parentID
        const turnCreatedAt = turnID ? state.turnCreatedMap.get(turnID) : null
        if (turnID && turnCreatedAt !== null && turnCreatedAt !== undefined && completedAt && completedAt >= turnCreatedAt) {
          state.turnRowMap.set(
            turnID,
            mergeTurnRows(state.turnRowMap.get(turnID), {
              id: turnID,
              session_id: sessionID,
              root_session_id: rootSessionID,
              project_id: projectID,
              content: null,
              synthetic: 0,
              compaction: 0,
              undone_at: null,
              time_created: turnCreatedAt,
              time_updated: completedAt,
              turn_duration_ms: Math.max(0, completedAt - turnCreatedAt),
            }),
          )
        }
      }

      const parts = partsByMessage.get(message.id) ?? []
      for (const part of parts) {
        const type = String(part.data.type ?? "")
        const partTimestamp = Number(part.data.time?.end ?? part.data.time?.updated ?? part.data.time?.start ?? part.timeCreated)

        if (type === "text" && role === "user") {
          state.turnRowMap.set(
            message.id,
            mergeTurnRows(state.turnRowMap.get(message.id), {
              id: message.id,
              session_id: sessionID,
              root_session_id: rootSessionID,
              project_id: projectID,
              content: textValue(part.data.text),
              synthetic: part.data.synthetic ? 1 : 0,
              compaction: 0,
              undone_at: null,
              time_created: Number(part.data.time?.start ?? partTimestamp),
              time_updated: partTimestamp,
              turn_duration_ms: null,
            }),
          )
        }

        if (type === "compaction") {
          state.turnRowMap.set(
            message.id,
            mergeTurnRows(state.turnRowMap.get(message.id), {
              id: message.id,
              session_id: sessionID,
              root_session_id: rootSessionID,
              project_id: projectID,
              content: null,
              synthetic: 1,
              compaction: 1,
              undone_at: null,
              time_created: Number(part.data.time?.start ?? partTimestamp),
              time_updated: partTimestamp,
              turn_duration_ms: null,
            }),
          )
        }

        if (type === "step-start") {
          state.messageStepMap.set(message.id, { id: part.id, startedAt: partTimestamp })
        }

        if (type === "step-finish") {
          const step = state.messageStepMap.get(message.id) ?? { id: part.id, startedAt: null }
          state.messageStepMap.set(message.id, step)
        }

        if (type === "tool" && state.responseMap.get(message.id)) {
          const toolCall = buildToolCall(
            { id: part.id, ...part.data },
            message.id,
            sessionID,
            rootSessionID,
            projectID,
            state.messageStepMap.get(message.id)?.id ?? null,
          )
          const toolDay = new Date(Number(toolCall.call.started_at ?? toolCall.call.time_updated)).toISOString().slice(0, 10)
          state.toolDayMap.set(part.id, toolDay)
        }
      }
    }
  } catch (error) {
    console.error("[usage-tracker] state hydration failed", error instanceof Error ? error.message : String(error))
  } finally {
    db?.close()
  }
}

/**
 * Main tracker plugin entrypoint.
 *
 * @param {{ project?: Record<string, unknown> }} input
 * @returns {Promise<Record<string, unknown>>}
 */
export const UsageTracker = async ({ project }) => {
  const state = createTrackerState(project)
  await hydrateStateFromOpenCodeDb(state)
  const queue = createIngestionQueue({ project, state })
  await queue.start()

  return {
    tool: {
      "usage-tracker-flush": tool({
        description: "Flush pending usage tracker writes and replay this process outbox.",
        args: {},
        async execute() {
          await queue.flush()
          return { ok: true, processID: queue.processID }
        },
      }),
      "usage-tracker-replay-all": tool({
        description: "Replay all durable usage tracker outbox batches.",
        args: {},
        async execute() {
          await queue.replayAllOutbox()
          return { ok: true }
        },
      }),
    },
    event: async ({ event }) => {
      try {
        await queue.enqueue(event)
      } catch (error) {
        console.error("[usage-tracker] enqueue failed", error instanceof Error ? error.message : String(error))
      }
    },
    "tool.execute.after": async (input, output) => {
      if (input.tool === "usage-tracker-flush" || input.tool === "usage-tracker-replay-all") {
        output.title = "Usage tracker maintenance"
      }
    },
    "command.execute.before": async (input) => {
      if (input.command === "exit") {
        await queue.flush()
      }
    },
    "tool.execute.before": async (input) => {
      if (input.tool === "usage-tracker-flush" || input.tool === "usage-tracker-replay-all") {
        await queue.flush()
      }
    },
  }
}
