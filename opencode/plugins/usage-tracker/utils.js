import { createHash } from "node:crypto"

/**
 * Recursively stringifies a value with stable object-key ordering.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`
}

/**
 * Produces a stable hash for a JSON-like payload.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function hashPayload(value) {
  return createHash("sha1").update(stableStringify(value)).digest("hex")
}

/**
 * Converts a value into a persisted text payload.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function textValue(value) {
  if (value === null || value === undefined) return null
  return typeof value === "string" ? value : JSON.stringify(value)
}

/**
 * Measures the UTF-8 byte length of a text payload.
 *
 * @param {unknown} value
 * @returns {number}
 */
export function byteLength(value) {
  const text = textValue(value)
  return text ? Buffer.byteLength(text, "utf8") : 0
}

/**
 * Deduplicates items by the derived key, keeping the last occurrence.
 *
 * @template T
 * @param {T[]} items
 * @param {(item: T) => string} keyFn
 * @returns {T[]}
 */
export function dedupeBy(items, keyFn) {
  const result = new Map()
  for (const item of items) {
    result.set(keyFn(item), item)
  }
  return Array.from(result.values())
}

/**
 * Waits for a number of milliseconds.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Converts unknown thrown values into loggable strings.
 *
 * @param {unknown} error
 * @returns {string}
 */
export function toErrorMessage(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Removes falsy entries from an array.
 *
 * @template T
 * @param {Array<T | null | undefined | false>} array
 * @returns {T[]}
 */
export function compact(array) {
  return array.filter(Boolean)
}

/**
 * Returns the first non-nullish value.
 *
 * @template T
 * @param {...(T | null | undefined)} values
 * @returns {T | null}
 */
export function coalesce(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined) return value
  }
  return null
}
