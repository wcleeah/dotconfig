import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
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
 * Creates a per-process durable outbox for failed Turso batches.
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

  /**
   * Builds the final JSON file path for a batch.
   *
   * @param {string} batchID
   * @returns {string}
   */
  function filePath(batchID) {
    return join(processDir, `${batchID}.json`)
  }

  return {
    root,
    processDir,
    /**
     * Persists a batch atomically.
     *
     * Writing to `*.tmp` first avoids exposing a partially written JSON file if
     * the process crashes mid-write. Replay code only looks for final `.json`
     * files, so temp files are never treated as valid batches.
     *
     * @param {QueueBatch} batch
     * @returns {string}
     */
    persist(batch) {
      const path = filePath(batch.batchID)
      const tempPath = `${path}.tmp`
      writeFileSync(tempPath, JSON.stringify(batch) + "\n")
      renameSync(tempPath, path)
      return path
    },
    /**
     * Deletes a persisted batch file.
     *
     * @param {string} batchID
     * @returns {void}
     */
    remove(batchID) {
      rmSync(filePath(batchID), { force: true })
    },
    /**
     * Lists batches owned by the current process directory.
     *
     * @returns {string[]}
     */
    list() {
      return readdirSync(processDir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => join(processDir, name))
        .sort((left, right) => statSync(left).mtimeMs - statSync(right).mtimeMs)
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
          return readdirSync(dir)
            .filter((name) => name.endsWith(".json"))
            .map((name) => join(dir, name))
        })
        .sort((left, right) => statSync(left).mtimeMs - statSync(right).mtimeMs)
    },
  }
}
