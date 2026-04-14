import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

/**
 * @typedef {import("./index").OutboxHandle} OutboxHandle
 * @typedef {import("./index").QueueBatch} QueueBatch
 */

/**
 * Returns the fixed local share directory used by the tracker.
 *
 * The tracker intentionally does not respect `XDG_DATA_HOME` for outbox files.
 * Using a single stable path keeps live writes and replay tooling aligned on the
 * same durable location.
 *
 * @returns {string}
 */
function dataHome() {
  return join(homedir(), ".local", "share")
}

/**
 * Ensures a directory exists and returns its path.
 *
 * @param {string} path
 * @returns {string}
 */
function ensureDir(path) {
  mkdirSync(path, { recursive: true })
  return path
}

/**
 * Reads and parses a JSON file.
 *
 * @param {string} filePath
 * @returns {QueueBatch}
 */
function safeReadJSON(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"))
}

/**
 * Creates a per-process durable queue batch journal.
 *
 * Batches are first written to a temporary file and then renamed into place.
 * The rename is an atomic publish step within the same directory, which keeps
 * replay code from ever observing a half-written `.json` file.
 *
 * @param {string} processID
 * @returns {OutboxHandle}
 */
export function createOutbox(processID) {
  const root = ensureDir(join(dataHome(), "opencode", "usage-outbox"))
  const processDir = ensureDir(join(root, processID))
  let nextSequence = 0

  /**
   * Builds the final JSON file path for a batch sequence.
   *
   * @param {number} sequence
   * @param {string} batchID
   * @returns {string}
   */
  function filePath(sequence, batchID) {
    return join(processDir, `${String(sequence).padStart(12, "0")}-${batchID}.json`)
  }

  /**
   * Parses the leading sequence from a journal file path.
   *
   * @param {string} file
   * @returns {number}
   */
  function sequenceFromPath(file) {
    const name = file.split("/").pop() ?? ""
    return Number.parseInt(name.split("-")[0] ?? "0", 10)
  }

  /**
   * Returns the current highest sequence number across all journal files.
   *
   * @returns {number}
   */
  function maxSequence() {
    return listFiles(processDir).reduce((max, file) => Math.max(max, sequenceFromPath(file)), 0)
  }

  /**
   * Lists journal files inside one directory in deterministic sequence order.
   *
   * @param {string} directory
   * @returns {string[]}
   */
  function listFiles(directory) {
    return readdirSync(directory)
      .filter((name) => name.endsWith(".json"))
      .map((name) => join(directory, name))
      .sort((left, right) => sequenceFromPath(left) - sequenceFromPath(right) || left.localeCompare(right))
  }

  nextSequence = maxSequence() + 1

  return {
    root,
    processDir,
    /**
     * Persists a batch atomically in deterministic sequence order.
     *
     * Writing to `*.tmp` first avoids exposing a partially written JSON file if
     * the process crashes mid-write. Replay code only looks for final `.json`
     * files, so temp files are never treated as valid batches.
     *
     * @param {QueueBatch} batch
     * @returns {{ file: string, sequence: number }}
      */
      persist(batch) {
       const sequence = batch.sequence ?? nextSequence++
       const payload = {
         ...batch,
        sequence,
        factsAppliedAt: batch.factsAppliedAt ?? null,
      }
       const path = filePath(sequence, batch.batchID)
       const tempPath = `${path}.tmp`
       writeFileSync(tempPath, JSON.stringify(payload) + "\n")
       renameSync(tempPath, path)
       return { file: path, sequence }
     },
    /**
     * Deletes a persisted batch file by batch id.
     *
     * @param {string} batchID
     * @returns {void}
     */
     remove(batchID) {
      const match = this.list().find((file) => this.read(file).batchID === batchID)
      if (match) rmSync(match, { force: true })
    },
    /**
     * Deletes a persisted batch file by path.
     *
     * @param {string} file
     * @returns {void}
     */
    removeFile(file) {
      rmSync(file, { force: true })
    },
    /**
     * Lists batches owned by the current process directory.
     *
     * @returns {string[]}
     */
     list() {
      return listFiles(processDir)
    },
    /**
     * Reads a persisted batch payload.
     *
     * @param {string} file
     * @returns {QueueBatch}
     */
    read(file) {
      return safeReadJSON(file)
    },
    /**
     * Lists all batches across all process directories.
     *
     * @returns {string[]}
     */
     listAllOrphans() {
        return readdirSync(root, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .flatMap((entry) => {
            const dir = join(root, entry.name)
            return listFiles(dir)
          })
          .sort((left, right) => sequenceFromPath(left) - sequenceFromPath(right) || left.localeCompare(right))
    },
  }
}
