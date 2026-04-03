import { tool } from "@opencode-ai/plugin"

import { createOpenCodeHydrator } from "./history.js"
import { createTrackerState } from "./normalize.js"
import { createIngestionQueue } from "./queue.js"

/**
 * Main tracker plugin entrypoint.
 *
 * @param {{ project?: Record<string, unknown> }} input
 * @returns {Promise<Record<string, unknown>>}
 */
export const UsageTracker = async ({ project }) => {
  const state = createTrackerState(project)
  const history = createOpenCodeHydrator({ state })
  await history.hydrateSessions()
  const queue = createIngestionQueue({
    project,
    state,
    ensureEventContext: history.hydrateEventContext,
  })
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
