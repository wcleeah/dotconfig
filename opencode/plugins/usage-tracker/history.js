import { Database } from "bun:sqlite"

import { buildResponse, buildToolCall, mergeTurnRows, rememberSessionProject } from "./normalize.js"
import { textValue, toErrorMessage } from "./utils.js"

/**
 * Resolves the OpenCode SQLite database path used for tracker backfills.
 *
 * @returns {string}
 */
function getOpenCodeDbPath() {
  return process.env.OPENCODE_DB || `${process.env.XDG_DATA_HOME || `${process.env.HOME}/.local/share`}/opencode/opencode.db`
}

/**
 * Formats a timestamp as a UTC analytics day key.
 *
 * @param {number | null | undefined} timestamp
 * @returns {string | null}
 */
function dayKey(timestamp) {
  if (timestamp === null || timestamp === undefined) return null
  return new Date(timestamp).toISOString().slice(0, 10)
}

/**
 * Builds a turn row shape used by historical backfills.
 *
 * @param {{
 *   id: string,
 *   sessionID: string,
 *   rootSessionID: string,
 *   projectID: string,
 *   content: string | null,
 *   synthetic: number,
 *   compaction: number,
 *   timeCreated: number,
 *   timeUpdated: number,
 *   turnDurationMs?: number | null,
 * }} input
 * @returns {Record<string, unknown>}
 */
function buildHistoricalTurnRow(input) {
  return {
    id: input.id,
    session_id: input.sessionID,
    root_session_id: input.rootSessionID,
    project_id: input.projectID,
    content: input.content,
    synthetic: input.synthetic,
    compaction: input.compaction,
    undone_at: null,
    time_created: input.timeCreated,
    time_updated: input.timeUpdated,
    turn_duration_ms: input.turnDurationMs ?? null,
  }
}

/**
 * Creates a targeted OpenCode DB hydrator.
 *
 * Startup only loads session lineage. Message and part history are backfilled on
 * demand for live events that depend on pre-existing context.
 *
 * @param {{
 *   state: import("./index").TrackerState,
 *   logger?: Console,
 *   dbPath?: string,
 * }} options
 */
export function createOpenCodeHydrator({ state, logger = console, dbPath = getOpenCodeDbPath() }) {
  let db = null
  let dbUnavailable = false
  const hydratedSessionIDs = new Set()
  const missingSessionIDs = new Set()
  const hydratedMessageIDs = new Set()
  const missingMessageIDs = new Set()

  /** @returns {Database | null} */
  function getDb() {
    if (db) return db
    if (dbUnavailable) return null

    try {
      db = new Database(dbPath, { readonly: true })
      return db
    } catch (error) {
      dbUnavailable = true
      logger.error("[usage-tracker] opencode db open failed", toErrorMessage(error))
      return null
    }
  }

  /**
   * Seeds session ancestry/project ownership for one session.
   *
   * @param {string | null | undefined} sessionID
   * @returns {Promise<void>}
   */
  async function hydrateSession(sessionID) {
    if (!sessionID || hydratedSessionIDs.has(sessionID) || missingSessionIDs.has(sessionID)) return

    const database = getDb()
    if (!database) return

    const row = database.query("SELECT id, project_id, parent_id FROM session WHERE id = ?").get(sessionID)
    if (!row) {
      missingSessionIDs.add(sessionID)
      return
    }

    const parentID = row.parent_id ? String(row.parent_id) : null
    if (parentID) await hydrateSession(parentID)

    hydratedSessionIDs.add(String(row.id))
    rememberSessionProject(state, {
      id: String(row.id),
      projectID: String(row.project_id),
      parentID,
    })
  }

  /**
   * Hydrates one message plus the historical part state needed by live events.
   *
   * @param {string | null | undefined} messageID
   * @returns {Promise<void>}
   */
  async function hydrateMessage(messageID) {
    if (!messageID || hydratedMessageIDs.has(messageID) || missingMessageIDs.has(messageID)) return

    const database = getDb()
    if (!database) return

    const row = database.query("SELECT id, session_id, time_created, data FROM message WHERE id = ?").get(messageID)
    if (!row) {
      missingMessageIDs.add(messageID)
      return
    }

    const sessionID = String(row.session_id)
    if (!state.sessionProjectMap.has(sessionID)) await hydrateSession(sessionID)

    let info
    try {
      info = JSON.parse(String(row.data))
    } catch (error) {
      missingMessageIDs.add(messageID)
      logger.error("[usage-tracker] message hydration failed", toErrorMessage(error))
      return
    }

    const id = String(row.id)
    const projectID = state.sessionProjectMap.get(sessionID) ?? state.projectID ?? "_unknown"
    const rootSessionID = state.rootSessionMap.get(sessionID) ?? sessionID
    const role = String(info.role ?? "")

    if (role) state.messageRoleMap.set(id, role)

    if (role === "user") {
      const createdAt = Number(info.time?.created ?? row.time_created)
      state.turnCreatedMap.set(id, createdAt)
      state.turnRowMap.set(
        id,
        mergeTurnRows(
          state.turnRowMap.get(id),
          buildHistoricalTurnRow({
            id,
            sessionID,
            rootSessionID,
            projectID,
            content: null,
            synthetic: 0,
            compaction: 0,
            timeCreated: createdAt,
            timeUpdated: createdAt,
          }),
        ),
      )
    }

    let response = null
    if (role === "assistant") {
      response = buildResponse({ id, parentID: info.parentID, sessionID, ...info }, rootSessionID, projectID)
      state.responseMap.set(id, response)
    }

    const parts = database
      .query("SELECT id, message_id, session_id, time_created, data FROM part WHERE message_id = ? ORDER BY time_created, id")
      .all(id)

    for (const partRow of parts) {
      let partData
      try {
        partData = JSON.parse(String(partRow.data))
      } catch (error) {
        logger.error("[usage-tracker] part hydration failed", toErrorMessage(error))
        continue
      }

      const part = {
        id: String(partRow.id),
        messageID: String(partRow.message_id),
        sessionID: String(partRow.session_id),
        timeCreated: Number(partRow.time_created),
        data: partData,
      }
      const type = String(part.data.type ?? "")
      const partTimestamp = Number(part.data.time?.end ?? part.data.time?.updated ?? part.data.time?.start ?? part.timeCreated)

      if (type === "text" && role === "user") {
        state.turnRowMap.set(
          id,
          mergeTurnRows(
            state.turnRowMap.get(id),
            buildHistoricalTurnRow({
              id,
              sessionID,
              rootSessionID,
              projectID,
              content: textValue(part.data.text),
              synthetic: part.data.synthetic ? 1 : 0,
              compaction: 0,
              timeCreated: Number(part.data.time?.start ?? partTimestamp),
              timeUpdated: partTimestamp,
            }),
          ),
        )
      }

      if (type === "compaction") {
        state.turnRowMap.set(
          id,
          mergeTurnRows(
            state.turnRowMap.get(id),
            buildHistoricalTurnRow({
              id,
              sessionID,
              rootSessionID,
              projectID,
              content: null,
              synthetic: 1,
              compaction: 1,
              timeCreated: Number(part.data.time?.start ?? partTimestamp),
              timeUpdated: partTimestamp,
            }),
          ),
        )
      }

      if (type === "step-start") {
        state.messageStepMap.set(id, { id: part.id, startedAt: partTimestamp })
      }

      if (type === "tool" && response) {
        const toolCall = buildToolCall(
          { id: part.id, ...part.data },
          id,
          sessionID,
          rootSessionID,
          projectID,
          state.messageStepMap.get(id)?.id ?? null,
        )
        const toolDay = dayKey(Number(toolCall.call.started_at ?? toolCall.call.time_updated))
        if (toolDay) state.toolDayMap.set(part.id, toolDay)
      }
    }

    hydratedMessageIDs.add(id)
  }

  return {
    /** @returns {Promise<void>} */
    async hydrateSessions() {
      const database = getDb()
      if (!database) return

      try {
        const sessions = database.query("SELECT id, project_id, parent_id, time_created FROM session ORDER BY time_created, id").all()
        for (const row of sessions) {
          hydratedSessionIDs.add(String(row.id))
          rememberSessionProject(state, {
            id: String(row.id),
            projectID: String(row.project_id),
            parentID: row.parent_id ? String(row.parent_id) : null,
          })
        }
      } catch (error) {
        logger.error("[usage-tracker] session hydration failed", toErrorMessage(error))
      }
    },
    /**
     * Backfills only the historical records required by the incoming event.
     *
     * @param {Record<string, any>} event
     * @returns {Promise<void>}
     */
    async hydrateEventContext(event) {
      switch (event.type) {
        case "message.updated": {
          const info = event.properties?.info
          if (info?.role === "assistant") {
            await hydrateMessage(info.parentID)
          }
          break
        }
        case "message.removed": {
          await hydrateMessage(event.properties?.messageID)
          break
        }
        case "message.part.updated": {
          await hydrateMessage(event.properties?.part?.messageID)
          break
        }
        default:
          break
      }
    },
  }
}
