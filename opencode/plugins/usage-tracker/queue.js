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
 * Returns whether any pending fact rows exist.
 *
 * @param {Record<string, Map<string, Record<string, unknown>>>} facts
 * @returns {boolean}
 */
function hasPendingFacts(facts) {
  return Object.values(facts).some((map) => map.size > 0)
}

/**
 * Returns whether any touched-key bucket is non-empty.
 *
 * @param {TouchedKeys} touched
 * @returns {boolean}
 */
function hasTouched(touched) {
  return Object.values(touched).some((items) => items.length > 0)
}

/**
 * Creates the live ingestion queue used by the tracker plugin.
 *
 * The queue batches normalized events in memory and flushes them asynchronously
 * so the event hook only pays the cost of normalization and queueing.
 *
 * @param {{
 *   project?: Record<string, unknown>,
 *   state: TrackerState,
 *   logger?: Console,
 *   ensureEventContext?: (event: Record<string, unknown>) => Promise<void>,
 *   turso?: ReturnType<typeof createTurso>,
 *   outbox?: ReturnType<typeof createOutbox>,
 *   setTimeoutFn?: (callback: () => void | Promise<void>, ms: number) => unknown,
 *   clearTimeoutFn?: (handle: unknown) => void,
 *   sleepFn?: (ms: number) => Promise<void>,
 *   flushDelayMs?: number,
 *   rollupDelayMs?: number,
 * }} options
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
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  sleepFn = sleep,
  flushDelayMs = 150,
  rollupDelayMs = 15000,
}) {
  const processID = `pid-${process.pid}-${Date.now()}`
  const turso = providedTurso ?? createTurso()
  const outbox = providedOutbox ?? createOutbox(processID)
  let pendingFacts = emptyFacts()
  let pendingTouched = emptyTouched()
  let pendingRollupTouched = emptyTouched()
  let pendingRollupFiles = new Map()
  let closed = false
  let initialized = false
  let flushTimer = null
  let rollupTimer = null
  let lastPersistedSequence = 0
  let factsAppliedThrough = 0
  let rollupsAppliedThrough = 0
  let nextProgressIndex = 1
  let journalQueue = []
  let journalProgress = new Map()
  let journalDraining = false
  let rollupRunning = false
  let rollupKickRequested = false
  let journalFailure = null
  let rollupFailure = null
  const factWaiters = new Map()
  const rollupWaiters = new Map()

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
   * Resolves progress waiters once progress reaches or passes their target.
   *
   * @param {Map<number, Array<{ resolve: () => void, reject: (error: Error) => void }>>} waiters
   * @param {number} progress
   * @returns {void}
   */
  function resolveProgressWaiters(waiters, progress) {
    for (const [target, resolvers] of Array.from(waiters.entries())) {
      if (progress < target) continue
      waiters.delete(target)
      for (const entry of resolvers) entry.resolve()
    }
  }

  /**
   * Rejects all pending waiters with the provided error.
   *
   * @param {Map<number, Array<{ resolve: () => void, reject: (error: Error) => void }>>} waiters
   * @param {Error} error
   * @returns {void}
   */
  function rejectProgressWaiters(waiters, error) {
    for (const resolvers of waiters.values()) {
      for (const entry of resolvers) entry.reject(error)
    }
    waiters.clear()
  }

  /**
   * Waits until the provided progress marker reaches the target index.
   *
   * @param {Map<number, Array<{ resolve: () => void, reject: (error: Error) => void }>>} waiters
   * @param {() => number} current
   * @param {number} target
   * @param {() => Error | null} currentFailure
   * @returns {Promise<void>}
   */
  function waitForProgressAtLeast(waiters, current, target, currentFailure) {
    if (target <= 0 || current() >= target) return Promise.resolve()
    const failure = currentFailure()
    if (failure) return Promise.reject(failure)

    return new Promise((resolve, reject) => {
      const bucket = waiters.get(target) ?? []
      bucket.push({ resolve, reject })
      waiters.set(target, bucket)
    })
  }

  /**
   * Waits until fact writes have been applied through the target index.
   *
   * @param {number} target
   * @returns {Promise<void>}
   */
  function waitForFactsThrough(target) {
    return waitForProgressAtLeast(factWaiters, () => factsAppliedThrough, target, () => journalFailure)
  }

  /**
   * Waits until rollups have converged through the target index.
   *
   * @param {number} target
   * @returns {Promise<void>}
   */
  function waitForRollupsThrough(target) {
    return waitForProgressAtLeast(rollupWaiters, () => rollupsAppliedThrough, target, () => rollupFailure)
  }

  /**
   * Returns the deterministic progress index for a journal file, creating it if needed.
   *
   * Progress indices are queue-local and monotonic. They are used only for
   * in-process waiting semantics, which avoids assuming that per-process durable
   * sequence numbers can be compared globally across orphan directories.
   *
   * @param {string} file
   * @returns {number}
   */
  function progressIndexForFile(file) {
    const existing = journalProgress.get(file)
    if (existing) return existing

    const created = nextProgressIndex++
    journalProgress.set(file, created)
    return created
  }

  /**
   * Queues one persisted journal entry for fact application.
   *
   * @param {{ file: string, sequence: number }} entry
   * @returns {number}
   */
  function enqueueJournalEntry(entry) {
    const progress = progressIndexForFile(entry.file)
    if (journalQueue.some((queued) => queued.file === entry.file)) return progress
    journalQueue.push(entry)
    journalQueue.sort((left, right) => left.sequence - right.sequence || left.file.localeCompare(right.file))
    return progress
  }

  /**
   * Persists one journal batch and returns its sequence.
   *
   * @param {QueueBatch} batch
   * @returns {Promise<number>}
   */
  async function persistJournalBatch(batch) {
    const entry = outbox.persist(batch)
    lastPersistedSequence = entry.sequence
    return enqueueJournalEntry(entry)
  }

  /**
   * Materializes the current in-memory fact accumulator into a durable journal entry.
   *
   * @returns {Promise<number | null>}
   */
  async function persistPendingBatch() {
    if (!hasPendingFacts(pendingFacts)) return null

    const facts = serializeFacts(pendingFacts)
    const touched = pendingTouched

    pendingFacts = emptyFacts()
    pendingTouched = emptyTouched()

    try {
      return await persistJournalBatch({
        batchID: randomUUID(),
        createdAt: Date.now(),
        facts,
        touched,
      })
    } catch (error) {
      // Persistence must be atomic from the queue's perspective. If durable
      // publish fails, merge the snapshot back so a later flush can retry it.
      mergeRows(pendingFacts, facts)
      mergeTouched(pendingTouched, touched)
      throw error
    }
  }

  /**
   * Schedules a delayed background rollup pass.
   *
   * @returns {void}
   */
  function scheduleRollupFlush() {
    if (closed || rollupTimer || !hasTouched(pendingRollupTouched)) return

    rollupTimer = setTimeoutFn(async () => {
      rollupTimer = null
      const target = Array.from(pendingRollupFiles.values()).reduce((max, sequence) => Math.max(max, sequence), rollupsAppliedThrough)
      kickRollupPass()
      try {
        await waitForRollupsThrough(target)
      } catch {}
    }, rollupDelayMs)
  }

  /**
   * Applies fact writes for one durable journal entry.
   *
   * @param {string} file
   * @returns {Promise<void>}
   */
  async function applyJournalFile(file) {
    const batch = outbox.read(file)
    const progress = progressIndexForFile(file)

    await init()
    await turso.writeFacts(batch.facts)

    if (!hasTouched(batch.touched)) {
      outbox.removeFile(file)
      journalProgress.delete(file)
      factsAppliedThrough = Math.max(factsAppliedThrough, progress)
      resolveProgressWaiters(factWaiters, factsAppliedThrough)
      rollupsAppliedThrough = Math.max(rollupsAppliedThrough, progress)
      resolveProgressWaiters(rollupWaiters, rollupsAppliedThrough)
      return
    }

    factsAppliedThrough = Math.max(factsAppliedThrough, progress)
    resolveProgressWaiters(factWaiters, factsAppliedThrough)
    mergeTouched(pendingRollupTouched, batch.touched)
    pendingRollupFiles.set(file, progress)
    scheduleRollupFlush()
  }

  /**
   * Drains persisted journal work in sequence order until the queue is empty.
   *
   * The queue item is removed before awaiting the fact write so the queue only
   * represents pending work. Failed items are pushed back to the front.
   *
   * @returns {Promise<void>}
   */
  async function drainJournalQueue() {
    try {
      while (!closed && journalQueue.length > 0) {
        const next = journalQueue.shift()
        if (!next) continue

        try {
          await applyJournalFile(next.file)
        } catch (error) {
          const failure = error instanceof Error ? error : new Error(toErrorMessage(error))
          journalFailure = failure
          logger.error("[usage-tracker] flush failed", toErrorMessage(error))
          journalQueue.unshift(next)
          rejectProgressWaiters(factWaiters, failure)
          return
        }

        await sleepFn(10)
      }
    } finally {
      journalDraining = false
      if (!closed && !journalFailure && journalQueue.length > 0) {
        kickJournalDrain()
      }
    }
  }

  /**
   * Starts draining the persisted journal queue if it is idle.
   *
   * @returns {void}
   */
  function kickJournalDrain() {
    if (closed || journalDraining || journalQueue.length === 0) return

    journalFailure = null
    journalDraining = true

    void drainJournalQueue()
  }

  /**
   * Executes one rollup pass over the current touched working set.
   *
   * Journal files are only removed after rollup replacement succeeds.
   *
   * @returns {Promise<void>}
   */
  async function flushRollupsOnce() {
    if (!hasTouched(pendingRollupTouched)) {
      rollupsAppliedThrough = Math.max(rollupsAppliedThrough, factsAppliedThrough)
      resolveProgressWaiters(rollupWaiters, rollupsAppliedThrough)
      return
    }

    const touched = pendingRollupTouched
    const files = Array.from(pendingRollupFiles.entries())
    pendingRollupTouched = emptyTouched()
    pendingRollupFiles = new Map()

    try {
      await init()
      const rollups = await recomputeTouchedRollups(turso, touched)
      await turso.replaceRollups(rollups)
      for (const [file] of files) {
        outbox.removeFile(file)
        journalProgress.delete(file)
      }
      const maxCovered = files.reduce((max, [, progress]) => Math.max(max, progress), rollupsAppliedThrough)
      rollupsAppliedThrough = Math.max(rollupsAppliedThrough, maxCovered)
      resolveProgressWaiters(rollupWaiters, rollupsAppliedThrough)
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(toErrorMessage(error))
      rollupFailure = failure
      logger.error("[usage-tracker] rollup flush failed", toErrorMessage(error))
      mergeTouched(pendingRollupTouched, touched)
      for (const [file, sequence] of files) {
        pendingRollupFiles.set(file, sequence)
      }
      rejectProgressWaiters(rollupWaiters, failure)
      scheduleRollupFlush()
    }
  }

  /**
   * Runs one detached rollup pass and then clears the running flag.
   *
   * If a second immediate pass was requested while the first was running, it is
   * started after the current pass finishes.
   *
   * @returns {Promise<void>}
   */
  async function runRollupPass() {
    try {
      await flushRollupsOnce()
    } finally {
      rollupRunning = false
      const rerunNow = !closed && rollupKickRequested && !rollupFailure && hasTouched(pendingRollupTouched)
      rollupKickRequested = false
      if (rerunNow) {
        kickRollupPass()
      }
    }
  }

  /**
   * Starts one rollup pass if none is currently running.
   *
   * @returns {void}
   */
  function kickRollupPass() {
    if (closed || !hasTouched(pendingRollupTouched)) return
    if (rollupRunning) {
      rollupKickRequested = true
      return
    }

    rollupFailure = null
    rollupRunning = true

    void runRollupPass()
  }

  /**
   * Schedules a delayed flush so nearby events collapse into one batch.
   *
   * @returns {void}
   */
  function scheduleFlush() {
    if (flushTimer) return
    flushTimer = setTimeoutFn(async () => {
      flushTimer = null
      let persisted = null
      try {
        persisted = await persistPendingBatch()
      } catch (error) {
        logger.error("[usage-tracker] persist failed", toErrorMessage(error))
        if (!closed) scheduleFlush()
        return
      }
      if (persisted === null) return
      kickJournalDrain()
      try {
        await waitForFactsThrough(persisted)
      } catch {}
    }, flushDelayMs)
  }

  /**
   * Replays durable journal files in order and forces rollup convergence.
   *
   * @param {string[]} files
   * @returns {Promise<void>}
   */
  async function replayOutbox(files) {
    let replayTarget = rollupsAppliedThrough

    for (const file of files) {
      if (closed) return

      const batch = outbox.read(file)
      const sequence = batch.sequence ?? 0

      try {
        const progress = enqueueJournalEntry({ file, sequence })
        replayTarget = Math.max(replayTarget, progress)
      } catch (error) {
        logger.error("[usage-tracker] replay failed", toErrorMessage(error))
        return
      }
    }

    if (rollupTimer) {
      clearTimeoutFn(rollupTimer)
      rollupTimer = null
    }

    kickJournalDrain()
    await waitForFactsThrough(replayTarget)
    kickRollupPass()
    await waitForRollupsThrough(replayTarget)
  }

  /**
   * Rebuilds in-memory recovery state from surviving durable journal files.
   *
   * Startup recovery re-establishes deterministic local ordering and then lets
   * the normal journal drain and rollup paths resume automatically.
   *
   * @returns {Promise<void>}
   */
  async function recoverFromJournal() {
    const files = outbox.listAllOrphans()
    if (files.length === 0) return

    let recoveryTarget = rollupsAppliedThrough

    for (const file of files) {
      const batch = outbox.read(file)
      const progress = enqueueJournalEntry({ file, sequence: batch.sequence ?? 0 })
      recoveryTarget = Math.max(recoveryTarget, progress)
      lastPersistedSequence = Math.max(lastPersistedSequence, batch.sequence ?? 0)
    }

    kickJournalDrain()
    await waitForFactsThrough(recoveryTarget)
    kickRollupPass()
    try {
      await waitForRollupsThrough(recoveryTarget)
    } catch (error) {
      logger.error("[usage-tracker] startup recovery rollup failed", toErrorMessage(error))
    }
  }

  return {
    processID,
    /** @returns {Promise<void>} */
    async start() {
      await recoverFromJournal()
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
        clearTimeoutFn(flushTimer)
        flushTimer = null
      }

      let target = lastPersistedSequence
      const persisted = await persistPendingBatch()
      if (persisted !== null) {
        target = persisted
      }

      kickJournalDrain()
      await waitForFactsThrough(target)

      if (rollupTimer) {
        clearTimeoutFn(rollupTimer)
        rollupTimer = null
      }

      kickRollupPass()
      await waitForRollupsThrough(target)
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
