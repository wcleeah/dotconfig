import { tool } from "@opencode-ai/plugin"
import { Database } from "bun:sqlite"

import { createTrackerState, rememberSessionProject } from "./normalize.js"
import { createIngestionQueue } from "./queue.js"

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
  try {
    const db = new Database(getOpenCodeDbPath(), { readonly: true })
    const rows = db
      .query("SELECT id, project_id, parent_id FROM session")
      .all()
    for (const row of rows) {
      rememberSessionProject(state, {
        id: row.id,
        projectID: row.project_id,
        parentID: row.parent_id,
      })
    }
    db.close()
  } catch (error) {
    console.error("[usage-tracker] state hydration failed", error instanceof Error ? error.message : String(error))
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
