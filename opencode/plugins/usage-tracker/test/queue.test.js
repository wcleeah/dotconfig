import { describe, expect, it } from "bun:test"

import { createTrackerState } from "../normalize.js"
import { createIngestionQueue } from "../queue.js"

function createFakeOutbox() {
  return {
    root: "/tmp/outbox",
    processDir: "/tmp/outbox/pid-test",
    persist() {},
    remove() {},
    list() {
      return []
    },
    read() {
      throw new Error("not used in test")
    },
    listAllOrphans() {
      return []
    },
  }
}

describe("ingestion queue", () => {
  it("defers Turso initialization and project writes until flush", async () => {
    const calls = []
    const queue = createIngestionQueue({
      project: {
        id: "proj_1",
        worktree: "/tmp/project",
        time: { created: 1000, updated: 1000 },
      },
      state: createTrackerState({ id: "proj_1" }),
      ensureEventContext: async () => {},
      outbox: createFakeOutbox(),
      turso: {
        async ensureSchema() {
          calls.push("ensureSchema")
        },
        async writeFacts(facts) {
          calls.push({ type: "writeFacts", facts })
        },
        async replaceRollups(rollups) {
          calls.push({ type: "replaceRollups", rollups })
        },
        async query() {
          return { rows: [], columns: [] }
        },
        async close() {
          calls.push("close")
        },
      },
    })

    await queue.start()
    expect(calls).toEqual([])

    await queue.flush()

    expect(calls[0]).toBe("ensureSchema")
    expect(calls[1]).toMatchObject({
      type: "writeFacts",
      facts: {
        projects: [
          {
            id: "proj_1",
            worktree: "/tmp/project",
          },
        ],
      },
    })
  })
})
