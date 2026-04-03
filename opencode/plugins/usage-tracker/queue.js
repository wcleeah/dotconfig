import { randomUUID } from "node:crypto"

import { createOutbox } from "./outbox.js"
import { createTurso } from "./turso.js"
import { buildProject, mergeTurnRows, normalizeEvent, rememberSessionProject } from "./normalize.js"
import { primaryKeyValue } from "./schema.js"
import { recomputeTouchedRollups } from "./rollups.js"
import { sleep, stableStringify, toErrorMessage } from "./utils.js"

/**
 * @typedef {import("./index").FactsPayload} FactsPayload
 * @typedef {import("./index").QueueBatch} QueueBatch
 * @typedef {import("./index").TouchedKeys} TouchedKeys
 * @typedef {import("./index").TrackerState} TrackerState
 */

/**
 * Merges normalized row batches into pending per-table maps.
 *
 * Turn rows use semantic merging because later updates may add content,
 * duration, or undo state to the same logical row.
 *
 * @param {Record<string, Map<string, Record<string, unknown>>>} target
 * @param {FactsPayload} source
 * @returns {void}
 */
function mergeRows(target, source) {
  for (const [tableName, rows] of Object.entries(source)) {
    const bucket = target[tableName] ?? new Map()
    for (const row of rows) {
      const key = primaryKeyValue(tableName, row)
      const existing = bucket.get(key)
      bucket.set(key, tableName === "turns" ? mergeTurnRows(existing, row) : row)
    }
    target[tableName] = bucket
  }
}

/**
 * Merges touched-key arrays while preserving uniqueness.
 *
 * @param {TouchedKeys} target
 * @param {TouchedKeys} source
 * @returns {void}
 */
function mergeTouched(target, source) {
  for (const key of Object.keys(target)) {
    const merged = new Map()
    for (const item of [...(target[key] ?? []), ...(source[key] ?? [])]) {
      merged.set(stableStringify(item), item)
    }
    target[key] = Array.from(merged.values())
  }
}

/**
 * Creates an empty per-table pending fact bucket.
 *
 * @returns {Record<string, Map<string, Record<string, unknown>>>}
 */
function emptyFacts() {
  return {
    projects: new Map(),
    sessions: new Map(),
    turns: new Map(),
    responses: new Map(),
    response_parts: new Map(),
    llm_steps: new Map(),
    tool_calls: new Map(),
    tool_payloads: new Map(),
  }
}

/**
 * Creates an empty touched-key accumulator.
 *
 * @returns {TouchedKeys}
 */
function emptyTouched() {
  return {
    projectIDs: [],
    sessionIDs: [],
    rootSessionIDs: [],
    days: [],
    projectDayKeys: [],
    modelKeys: [],
    toolKeys: [],
  }
}

/**
 * Converts pending fact maps into plain JSON-serializable arrays.
 *
 * @param {Record<string, Map<string, Record<string, unknown>>>} facts
 * @returns {FactsPayload}
 */
function serializeFacts(facts) {
  return Object.fromEntries(Object.entries(facts).map(([tableName, rows]) => [tableName, Array.from(rows.values())]))
}

/**
 * Creates the live ingestion queue used by the tracker plugin.
 *
 * The queue batches normalized events in memory and flushes them asynchronously
 * so the event hook only pays the cost of normalization and queueing.
 *
 * @param {{ project?: Record<string, unknown>, state: TrackerState, logger?: Console }} options
 * @returns {{
 *   processID: string,
 *   start(): Promise<void>,
 *   enqueue(event: Record<string, unknown>): Promise<void>,
 *   flush(): Promise<void>,
 *   close(): Promise<void>,
 *   replayAllOutbox(): Promise<void>,
 * }}
 */
export function createIngestionQueue({
  project,
  state,
  logger = console,
  ensureEventContext = async () => {},
  turso: providedTurso,
  outbox: providedOutbox,
}) {
  const processID = `pid-${process.pid}-${Date.now()}`
  const turso = providedTurso ?? createTurso()
  const outbox = providedOutbox ?? createOutbox(processID)
  const queue = []
  let pendingFacts = emptyFacts()
  let pendingTouched = emptyTouched()
  let running = false
  let closed = false
  let initialized = false
  let flushTimer = null

  if (project) {
    mergeRows(pendingFacts, { projects: [buildProject(project)] })
  }

  /** @returns {Promise<void>} */
  async function init() {
    if (initialized) return
    await turso.ensureSchema()
    initialized = true
  }

  /**
   * Writes one batch to Turso and recomputes touched rollups.
   *
   * @param {QueueBatch} batch
   * @returns {Promise<void>}
   */
  async function flushBatch(batch) {
    await init()
    await turso.writeFacts(batch.facts)
    const rollups = await recomputeTouchedRollups(turso, batch.touched)
    await turso.replaceRollups(rollups)
  }

  /**
   * Drains the in-memory queue sequentially.
   *
   * Failed batches are moved into the durable outbox instead of retried in a
   * tight loop during the same runtime turn.
   *
   * @returns {Promise<void>}
   */
  async function processLoop() {
    if (running || closed) return
    running = true
    while (queue.length > 0 && !closed) {
      const batch = queue.shift()
      try {
        await flushBatch(batch)
      } catch (error) {
        logger.error("[usage-tracker] flush failed", toErrorMessage(error))
        outbox.persist({
          batchID: batch.batchID,
          retryCount: (batch.retryCount ?? 0) + 1,
          facts: batch.facts,
          touched: batch.touched,
          createdAt: batch.createdAt,
        })
      }
      await sleep(10)
    }
    running = false
  }

  /**
   * Schedules a delayed flush so nearby events collapse into one batch.
   *
   * @returns {void}
   */
  function scheduleFlush() {
    if (flushTimer) return
    flushTimer = setTimeout(() => {
      flushTimer = null
      const hasPending = Object.values(pendingFacts).some((map) => map.size > 0)
      if (!hasPending) return
      queue.push({
        batchID: randomUUID(),
        createdAt: Date.now(),
        facts: serializeFacts(pendingFacts),
        touched: pendingTouched,
      })
      pendingFacts = emptyFacts()
      pendingTouched = emptyTouched()
      void processLoop()
    }, 150)
  }

  /**
   * Replays durable outbox files in order.
   *
   * @param {string[]} files
   * @returns {Promise<void>}
   */
  async function replayOutbox(files) {
    for (const file of files) {
      if (closed) return
      try {
        const payload = outbox.read(file)
        await flushBatch(payload)
        outbox.remove(payload.batchID)
      } catch (error) {
        logger.error("[usage-tracker] replay failed", toErrorMessage(error))
      }
    }
  }

  return {
    processID,
    /** @returns {Promise<void>} */
    async start() {
      // Startup stays local and synchronous. Schema creation and writes happen
      // on the first real flush so plugin initialization does not wait on Turso.
    },
    /**
     * Normalizes and queues one OpenCode event.
     *
     * @param {Record<string, unknown>} event
     * @returns {Promise<void>}
     */
    async enqueue(event) {
      if (closed) return
      if (event.type === "session.created" || event.type === "session.updated" || event.type === "session.deleted") {
        rememberSessionProject(state, event.properties.info)
      }
      await ensureEventContext(event)
      const normalized = normalizeEvent(event, state)
      mergeRows(pendingFacts, normalized.facts)
      mergeTouched(pendingTouched, normalized.touched)
      scheduleFlush()
    },
    /** @returns {Promise<void>} */
    async flush() {
      if (flushTimer) {
        clearTimeout(flushTimer)
        flushTimer = null
      }
      const hasPending = Object.values(pendingFacts).some((map) => map.size > 0)
      if (hasPending) {
        queue.push({
          batchID: randomUUID(),
          createdAt: Date.now(),
          facts: serializeFacts(pendingFacts),
          touched: pendingTouched,
        })
        pendingFacts = emptyFacts()
        pendingTouched = emptyTouched()
      }
      await processLoop()
      await replayOutbox(outbox.list())
    },
    /** @returns {Promise<void>} */
    async close() {
      await this.flush()
      closed = true
      await turso.close()
    },
    /** @returns {Promise<void>} */
    async replayAllOutbox() {
      await replayOutbox(outbox.listAllOrphans())
    },
  }
}
