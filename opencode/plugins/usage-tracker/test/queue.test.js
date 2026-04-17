import { describe, expect, it } from "bun:test"

import { createTrackerState } from "../normalize.js"
import { createIngestionQueue } from "../queue.js"

function createFakeOutbox() {
  const compareFiles = (left, right) => left.localeCompare(right)

  return {
    root: "/tmp/outbox",
    processDir: "/tmp/outbox/pid-test",
    persisted: [],
    records: new Map(),
    removed: [],
    orphanFiles: [],
    persist(batch) {
      const sequence = batch.sequence ?? this.persisted.length + 1
      const file = `/tmp/outbox/pid-test/${String(sequence).padStart(12, "0")}-${batch.batchID}.json`
      const payload = { ...batch, sequence, factsAppliedAt: batch.factsAppliedAt ?? null, __file: file }
      this.persisted.push(payload)
      this.records.set(file, payload)
      return { file, sequence }
    },
    remove(batchID) {
      const match = this.persisted.find((batch) => batch.batchID === batchID)
      if (match) this.removeFile(match.__file)
    },
    removeFile(file) {
      this.removed.push(file)
      this.persisted = this.persisted.filter((batch) => batch.__file !== file)
      this.records.delete(file)
      this.orphanFiles = this.orphanFiles.filter((entry) => entry !== file)
    },
    list() {
      return this.persisted.map((batch) => batch.__file).sort(compareFiles)
    },
    read(file) {
      const batch = this.records.get(file)
      if (!batch) throw new Error(`unknown batch file: ${file}`)
      const { __file, ...payload } = batch
      return payload
    },
    listAllOrphans() {
      return [...this.orphanFiles].sort(compareFiles)
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

function createDeferred() {
  let resolve = () => {}
  let reject = () => {}
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
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
    rollupDelayMs: options.rollupDelayMs ?? 15000,
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
    expect(harness.outbox.persisted).toHaveLength(0)
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
    expect(harness.turso.counters.queryCount).toBe(0)
    expect(harness.timers.pendingCount()).toBe(1)
  })

  it("persists a flushed batch before remote fact writes begin under the durable journal model", async () => {
    const harness = createQueueHarness()

    await harness.queue.enqueue(createSessionCreatedEvent())
    await harness.queue.enqueue(createUserMessageEvent())

    await harness.timers.runNextTimer()

    expect(harness.outbox.persisted).toHaveLength(1)
    expect(harness.outbox.persisted[0]).toMatchObject({
      sequence: 1,
      factsAppliedAt: null,
    })
    expect(harness.turso.counters.writeFactsCount).toBe(1)
  })

  it("replays surviving durable batches in explicit deterministic order after restart", async () => {
    const outbox = createFakeOutbox()
    const harness = createQueueHarness({ outbox })

    outbox.persist({
      batchID: "batch-b",
      sequence: 2,
      createdAt: 2000,
      facts: {
        projects: [],
        sessions: [{ id: "ses_later", project_id: "proj_1" }],
        turns: [],
        responses: [],
        response_parts: [],
        llm_steps: [],
        tool_calls: [],
        tool_payloads: [],
      },
      touched: {
        projectIDs: ["proj_1"],
        sessionIDs: ["ses_later"],
        rootSessionIDs: ["ses_later"],
        days: [],
        projectDayKeys: [],
        modelKeys: [],
        toolKeys: [],
      },
    })
    outbox.persist({
      batchID: "batch-a",
      sequence: 1,
      createdAt: 1000,
      facts: {
        projects: [],
        sessions: [{ id: "ses_earlier", project_id: "proj_1" }],
        turns: [],
        responses: [],
        response_parts: [],
        llm_steps: [],
        tool_calls: [],
        tool_payloads: [],
      },
      touched: {
        projectIDs: ["proj_1"],
        sessionIDs: ["ses_earlier"],
        rootSessionIDs: ["ses_earlier"],
        days: [],
        projectDayKeys: [],
        modelKeys: [],
        toolKeys: [],
      },
    })
    outbox.orphanFiles = outbox.list()

    await harness.queue.replayAllOutbox()

    expect(harness.turso.counters.writes.map((facts) => facts.sessions[0]?.id)).toEqual(["ses_earlier", "ses_later"])
  })

  it("keeps hot-path rollup query count at zero until the rollup timer fires", async () => {
    const harness = createQueueHarness()

    await enqueueRepresentativeHotPath(harness.queue)

    expect(harness.ensureEventContextCalls).toHaveLength(4)
    expect(harness.timers.pendingCount()).toBe(1)

    await harness.timers.runNextTimer()

    expect(harness.turso.counters.writeFactsCount).toBeGreaterThan(0)
    expect(harness.turso.counters.replaceRollupsCount).toBe(0)
    expect(harness.turso.counters.queryCount).toBe(0)
    expect(harness.timers.pendingCount()).toBe(1)

    await harness.timers.runNextTimer()

    expect(harness.turso.counters.replaceRollupsCount).toBeGreaterThan(0)
    expect(harness.turso.counters.queryCount).toBeGreaterThan(0)
    expect(harness.turso.counters.queries.some((entry) => entry.sql.includes("tool_calls"))).toBe(true)
  })

  it("keeps durable work pending when a background rollup pass fails", async () => {
    const harness = createQueueHarness()
    harness.turso.fail.replaceRollups = 1

    await enqueueRepresentativeHotPath(harness.queue)
    await harness.timers.runNextTimer()

    expect(harness.outbox.persisted).toHaveLength(1)

    await harness.timers.runNextTimer()

    expect(harness.turso.counters.replaceRollupsCount).toBe(1)
    expect(harness.outbox.persisted).toHaveLength(1)
    expect(harness.timers.pendingCount()).toBe(1)
  })

  it("drains durable fact work and durable rollup work before flush returns", async () => {
    const harness = createQueueHarness()

    await enqueueRepresentativeHotPath(harness.queue)

    expect(harness.outbox.persisted).toHaveLength(0)
    expect(harness.turso.counters.writeFactsCount).toBe(0)
    expect(harness.turso.counters.replaceRollupsCount).toBe(0)

    await harness.queue.flush()

    expect(harness.turso.counters.writeFactsCount).toBe(1)
    expect(harness.turso.counters.replaceRollupsCount).toBe(1)
    expect(harness.turso.counters.queryCount).toBeGreaterThan(0)
    expect(harness.outbox.persisted).toHaveLength(0)
    expect(harness.timers.pendingCount()).toBe(0)
  })

  it("forces orphan replay to converge rollups before returning", async () => {
    const outbox = createFakeOutbox()
    const firstHarness = createQueueHarness({ outbox })

    await firstHarness.queue.enqueue(createSessionCreatedEvent())
    await firstHarness.queue.enqueue(createUserMessageEvent())
    await firstHarness.queue.enqueue(createAssistantMessageEvent())
    await firstHarness.queue.enqueue(createToolPartEvent())
    await firstHarness.timers.runNextTimer()

    outbox.orphanFiles = outbox.list()

    const replayHarness = createQueueHarness({ outbox, turso: firstHarness.turso })

    await replayHarness.queue.replayAllOutbox()

    expect(firstHarness.turso.counters.writeFactsCount).toBe(2)
    expect(firstHarness.turso.counters.replaceRollupsCount).toBe(1)
    expect(firstHarness.turso.counters.queryCount).toBeGreaterThan(0)
    expect(outbox.orphanFiles).toHaveLength(0)
    expect(outbox.persisted).toHaveLength(0)
  })

  it("startup recovery scans surviving journal files and converges before start returns", async () => {
    const outbox = createFakeOutbox()
    const harness = createQueueHarness({ outbox })

    outbox.persist({
      batchID: "batch-startup",
      sequence: 7,
      createdAt: 7000,
      facts: {
        projects: [],
        sessions: [{ id: "ses_startup", project_id: "proj_1", root_session_id: "ses_startup" }],
        turns: [],
        responses: [],
        response_parts: [],
        llm_steps: [],
        tool_calls: [],
        tool_payloads: [],
      },
      touched: {
        projectIDs: ["proj_1"],
        sessionIDs: ["ses_startup"],
        rootSessionIDs: ["ses_startup"],
        days: ["2026-01-01"],
        projectDayKeys: [["proj_1", "2026-01-01"]],
        modelKeys: [],
        toolKeys: [],
      },
    })
    outbox.orphanFiles = outbox.list()

    await harness.queue.start()

    expect(harness.turso.counters.writeFactsCount).toBe(1)
    expect(harness.turso.counters.replaceRollupsCount).toBe(1)
    expect(harness.turso.counters.queryCount).toBeGreaterThan(0)
    expect(outbox.persisted).toHaveLength(0)
    expect(outbox.orphanFiles).toHaveLength(0)
  })

  it("fact write failure keeps durable work pending for later restart recovery", async () => {
    const outbox = createFakeOutbox()
    const firstHarness = createQueueHarness({ outbox })

    await enqueueRepresentativeHotPath(firstHarness.queue)
    firstHarness.turso.fail.writeFacts = 1

    await firstHarness.timers.runNextTimer()

    expect(firstHarness.turso.counters.writeFactsCount).toBe(1)
    expect(firstHarness.turso.counters.replaceRollupsCount).toBe(0)
    expect(outbox.persisted).toHaveLength(1)
    expect(outbox.removed).toHaveLength(0)

    const restartHarness = createQueueHarness({ outbox, turso: firstHarness.turso })
    outbox.orphanFiles = outbox.list()

    await restartHarness.queue.start()

    expect(firstHarness.turso.counters.writeFactsCount).toBe(2)
    expect(firstHarness.turso.counters.replaceRollupsCount).toBe(1)
    expect(outbox.persisted).toHaveLength(0)
    expect(outbox.orphanFiles).toHaveLength(0)
  })

  it("rollup success removes durable files only after replacement succeeds", async () => {
    const harness = createQueueHarness()

    await enqueueRepresentativeHotPath(harness.queue)
    await harness.timers.runNextTimer()

    const persistedFile = harness.outbox.list()[0]
    expect(persistedFile).toBeDefined()
    expect(harness.outbox.removed).toHaveLength(0)

    await harness.timers.runNextTimer()

    expect(harness.turso.counters.replaceRollupsCount).toBe(1)
    expect(harness.outbox.removed).toEqual([persistedFile])
    expect(harness.outbox.persisted).toHaveLength(0)
  })

  it("restart recovery plus rollup failure keeps durable work pending until a later successful retry", async () => {
    const outbox = createFakeOutbox()
    const firstHarness = createQueueHarness({ outbox })

    await enqueueRepresentativeHotPath(firstHarness.queue)
    await firstHarness.timers.runNextTimer()

    expect(outbox.persisted).toHaveLength(1)

    const restartHarness = createQueueHarness({ outbox, turso: firstHarness.turso })
    outbox.orphanFiles = outbox.list()
    restartHarness.turso.fail.replaceRollups = 1

    await restartHarness.queue.start()

    expect(firstHarness.turso.counters.replaceRollupsCount).toBe(1)
    expect(outbox.persisted).toHaveLength(1)
    expect(outbox.orphanFiles).toHaveLength(1)

    restartHarness.turso.fail.replaceRollups = 0
    await restartHarness.queue.replayAllOutbox()

    expect(firstHarness.turso.counters.replaceRollupsCount).toBe(2)
    expect(outbox.persisted).toHaveLength(0)
    expect(outbox.orphanFiles).toHaveLength(0)
  })

  it("flush waits for an already-started journal drain without losing work", async () => {
    const writeGate = createDeferred()
    const turso = createFakeTurso()
    const originalWriteFacts = turso.writeFacts
    turso.writeFacts = async (facts) => {
      await writeGate.promise
      return await originalWriteFacts(facts)
    }

    const harness = createQueueHarness({ turso })

    await enqueueRepresentativeHotPath(harness.queue)
    const timerRun = harness.timers.runNextTimer()
    await Promise.resolve()

    const flushRun = harness.queue.flush()
    await Promise.resolve()

    expect(harness.outbox.persisted).toHaveLength(1)
    expect(harness.turso.counters.writeFactsCount).toBe(0)

    writeGate.resolve()
    await timerRun
    await flushRun

    expect(harness.turso.counters.writeFactsCount).toBe(1)
    expect(harness.turso.counters.replaceRollupsCount).toBe(1)
    expect(harness.outbox.persisted).toHaveLength(0)
  })

  it("concurrent flush calls converge the same already-known work", async () => {
    const harness = createQueueHarness()

    await enqueueRepresentativeHotPath(harness.queue)

    const [first, second] = await Promise.all([harness.queue.flush(), harness.queue.flush()])

    expect(first).toBeUndefined()
    expect(second).toBeUndefined()
    expect(harness.turso.counters.writeFactsCount).toBe(1)
    expect(harness.turso.counters.replaceRollupsCount).toBe(1)
    expect(harness.outbox.persisted).toHaveLength(0)
    expect(harness.timers.pendingCount()).toBe(0)
  })
})
