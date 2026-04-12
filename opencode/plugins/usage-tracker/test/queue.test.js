import { describe, expect, it } from "bun:test"

import { createTrackerState } from "../normalize.js"
import { createIngestionQueue } from "../queue.js"

function createFakeOutbox() {
  return {
    root: "/tmp/outbox",
    processDir: "/tmp/outbox/pid-test",
    persisted: [],
    persist(batch) {
      this.persisted.push(batch)
    },
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

function createFakeTimers() {
  const scheduled = []

  return {
    scheduled,
    setTimeoutFn(callback, ms) {
      const handle = { callback, ms, cleared: false }
      scheduled.push(handle)
      return handle
    },
    clearTimeoutFn(handle) {
      if (handle) handle.cleared = true
    },
    async runNextTimer() {
      const handle = scheduled.shift()
      if (!handle || handle.cleared) return false
      await handle.callback()
      return true
    },
    async runAllTimers() {
      let ran = false
      while (await this.runNextTimer()) {
        ran = true
      }
      return ran
    },
    pendingCount() {
      return scheduled.filter((handle) => !handle.cleared).length
    },
  }
}

function createFakeTurso() {
  const counters = {
    ensureSchemaCount: 0,
    writeFactsCount: 0,
    replaceRollupsCount: 0,
    queryCount: 0,
    closeCount: 0,
    writes: [],
    replaceRollupsPayloads: [],
    queries: [],
  }
  const fail = {
    writeFacts: 0,
    replaceRollups: 0,
    query: 0,
  }

  return {
    counters,
    fail,
    async ensureSchema() {
      counters.ensureSchemaCount += 1
    },
    async writeFacts(facts) {
      counters.writeFactsCount += 1
      counters.writes.push(facts)
      if (fail.writeFacts > 0) {
        fail.writeFacts -= 1
        throw new Error("writeFacts failed")
      }
    },
    async replaceRollups(rollups) {
      counters.replaceRollupsCount += 1
      counters.replaceRollupsPayloads.push(rollups)
      if (fail.replaceRollups > 0) {
        fail.replaceRollups -= 1
        throw new Error("replaceRollups failed")
      }
    },
    async query(sql, args) {
      counters.queryCount += 1
      counters.queries.push({ sql, args })
      if (fail.query > 0) {
        fail.query -= 1
        throw new Error("query failed")
      }
      return { rows: [], columns: [] }
    },
    async close() {
      counters.closeCount += 1
    },
  }
}

function createQueueHarness(options = {}) {
  const timers = createFakeTimers()
  const outbox = options.outbox ?? createFakeOutbox()
  const turso = options.turso ?? createFakeTurso()
  const ensureEventContextCalls = []
  const state = createTrackerState({ id: "proj_1" })
  const queue = createIngestionQueue({
    project: options.project,
    state,
    outbox,
    turso,
    flushDelayMs: options.flushDelayMs ?? 150,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    sleepFn: async () => {},
    ensureEventContext: async (event) => {
      ensureEventContextCalls.push(event)
      await options.ensureEventContext?.(event)
    },
  })

  return {
    queue,
    state,
    timers,
    outbox,
    turso,
    ensureEventContextCalls,
  }
}

function createProject() {
  return {
    id: "proj_1",
    worktree: "/tmp/project",
    vcs: "git",
    name: "demo-project",
    time: { created: 1000, updated: 1000 },
  }
}

function createSessionCreatedEvent() {
  return {
    type: "session.created",
    properties: {
      info: {
        id: "ses_root",
        projectID: "proj_1",
        slug: "root",
        directory: "/tmp/project",
        title: "Root session",
        version: "1.0.0",
        time: { created: 1000, updated: 1000 },
      },
    },
  }
}

function createUserMessageEvent() {
  return {
    type: "message.updated",
    properties: {
      info: {
        id: "msg_user",
        role: "user",
        sessionID: "ses_root",
        time: { created: Date.UTC(2026, 0, 1, 10, 0) },
      },
    },
  }
}

function createAssistantMessageEvent() {
  return {
    type: "message.updated",
    properties: {
      info: {
        id: "msg_assistant",
        role: "assistant",
        parentID: "msg_user",
        sessionID: "ses_root",
        providerID: "github-copilot",
        modelID: "gpt-5.4",
        finish: "tool-calls",
        time: {
          created: Date.UTC(2026, 0, 1, 10, 1),
          completed: Date.UTC(2026, 0, 1, 10, 2),
        },
      },
    },
  }
}

function createToolPartEvent() {
  return {
    type: "message.part.updated",
    properties: {
      part: {
        id: "tool_1",
        type: "tool",
        messageID: "msg_assistant",
        sessionID: "ses_root",
        callID: "call_1",
        tool: "read",
        state: {
          status: "completed",
          input: { filePath: "/tmp/file.ts" },
          output: "ok",
          title: "Reads file",
          time: {
            start: Date.UTC(2026, 0, 1, 10, 1, 30),
            end: Date.UTC(2026, 0, 1, 10, 1, 31),
          },
        },
      },
    },
  }
}

async function enqueueRepresentativeHotPath(queue) {
  const events = [
    createSessionCreatedEvent(),
    createUserMessageEvent(),
    createAssistantMessageEvent(),
    createToolPartEvent(),
  ]

  for (const event of events) {
    await queue.enqueue(event)
  }

  return events
}

describe("ingestion queue", () => {
  it("defers Turso initialization and project writes until flush", async () => {
    const harness = createQueueHarness({
      project: createProject(),
    })

    await harness.queue.start()

    expect(harness.turso.counters.ensureSchemaCount).toBe(0)
    expect(harness.turso.counters.writeFactsCount).toBe(0)

    await harness.queue.flush()

    expect(harness.turso.counters.ensureSchemaCount).toBe(1)
    expect(harness.turso.counters.writeFactsCount).toBe(1)
    expect(harness.turso.counters.writes[0]).toMatchObject({
      projects: [
        {
          id: "proj_1",
          worktree: "/tmp/project",
        },
      ],
    })
  })

  it("provides a deterministic timer harness for queued flushes", async () => {
    const harness = createQueueHarness()

    await harness.queue.enqueue(createSessionCreatedEvent())

    expect(harness.timers.pendingCount()).toBe(1)
    expect(harness.turso.counters.writeFactsCount).toBe(0)

    await harness.timers.runNextTimer()

    expect(harness.turso.counters.writeFactsCount).toBe(1)
    expect(harness.timers.pendingCount()).toBe(0)
  })

  it("exposes the current hot-path rollup baseline without hard-coding it", async () => {
    const harness = createQueueHarness()

    const events = await enqueueRepresentativeHotPath(harness.queue)

    expect(events.map((event) => event.type)).toEqual([
      "session.created",
      "message.updated",
      "message.updated",
      "message.part.updated",
    ])
    expect(harness.ensureEventContextCalls).toHaveLength(4)
    expect(harness.timers.pendingCount()).toBe(1)

    await harness.timers.runNextTimer()

    expect(harness.turso.counters.writeFactsCount).toBeGreaterThan(0)
    expect(harness.turso.counters.replaceRollupsCount).toBeGreaterThan(0)
    expect(harness.turso.counters.queryCount).toBeGreaterThan(0)
    expect(harness.turso.counters.queries.some((entry) => entry.sql.includes("tool_calls"))).toBe(true)
  })

  it.todo("persists a flushed batch before remote fact writes begin under the durable journal model")

  it.todo("replays surviving durable batches in explicit deterministic order after restart")

  it.todo("keeps hot-path rollup query count at zero until the rollup timer fires")

  it.todo("keeps durable work pending when a background rollup pass fails")

  it.todo("drains durable fact work and durable rollup work before flush returns")

  it.todo("forces orphan replay to converge rollups before returning")
})
