import { createClient } from "@libsql/client"

import { CREATE_STATEMENTS, FACT_TABLE_ORDER, INDEX_STATEMENTS, ROLLUP_TABLES, SCHEMA_VERSION, makeUpsertStatement, rowArgs } from "./schema.js"

/**
 * @typedef {import("./index").FactsPayload} FactsPayload
 * @typedef {import("./index").RollupReplacePayload} RollupReplacePayload
 */

const FACT_UPSERTS = new Map(FACT_TABLE_ORDER.map((table) => [table.name, makeUpsertStatement(table)]))
const ROLLUP_UPSERTS = new Map(Object.values(ROLLUP_TABLES).map((table) => [table.name, makeUpsertStatement(table)]))
const FACT_TABLES_BY_NAME = new Map(FACT_TABLE_ORDER.map((table) => [table.name, table]))
const ROLLUP_TABLES_BY_NAME = new Map(Object.values(ROLLUP_TABLES).map((table) => [table.name, table]))
const BATCH_SIZE = 100

/**
 * Executes write statements in deterministic chunks.
 *
 * @param {import("@libsql/client").Client} client
 * @param {Array<{ sql: string, args?: unknown[] }>} statements
 * @returns {Promise<void>}
 */
async function runInChunks(client, statements) {
  for (let index = 0; index < statements.length; index += BATCH_SIZE) {
    await client.batch(statements.slice(index, index + BATCH_SIZE), "write")
  }
}

/**
 * Creates the Turso client using environment-provided credentials.
 *
 * @returns {import("@libsql/client").Client}
 */
function getClient() {
  const url = process.env.TURSO_DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN
  if (!url) throw new Error("Missing TURSO_DATABASE_URL")
  if (!authToken) throw new Error("Missing TURSO_AUTH_TOKEN")
  return createClient({ url, authToken })
}

/**
 * Creates the tracker Turso facade.
 *
 * @returns {{
 *   client: import("@libsql/client").Client,
 *   ensureSchema(): Promise<void>,
 *   writeFacts(facts: FactsPayload): Promise<void>,
 *   replaceRollups(rollups: Record<string, RollupReplacePayload | undefined>): Promise<void>,
 *   query(sql: string, args?: unknown[]): Promise<import("@libsql/client").ResultSet>,
 *   close(): Promise<void>,
 * }}
 */
export function createTurso() {
  const client = getClient()

  return {
    client,
    /**
     * Ensures tables, indexes, and schema metadata exist before writes.
     *
     * @returns {Promise<void>}
     */
    async ensureSchema() {
      const statements = [
        ...CREATE_STATEMENTS.map((sql) => ({ sql })),
        ...INDEX_STATEMENTS.map((sql) => ({ sql })),
        {
          sql: "INSERT INTO schema_meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
          args: ["schema_version", String(SCHEMA_VERSION), Date.now()],
        },
      ]
      await runInChunks(client, statements)
    },
    /**
     * Upserts tracker fact rows into Turso.
     *
     * @param {FactsPayload} facts
     * @returns {Promise<void>}
     */
    async writeFacts(facts) {
      const statements = []
      for (const [tableName, rows] of Object.entries(facts)) {
        if (!rows?.length) continue
        const table = FACT_TABLES_BY_NAME.get(tableName)
        if (!table) continue
        const sql = FACT_UPSERTS.get(tableName)
        for (const row of rows) {
          statements.push({ sql, args: rowArgs(table, row) })
        }
      }
      if (statements.length === 0) return
      await runInChunks(client, statements)
    },
    /**
     * Replaces rollup rows by deleting touched keys and upserting fresh rows.
     *
     * @param {Record<string, RollupReplacePayload | undefined>} rollups
     * @returns {Promise<void>}
     */
    async replaceRollups(rollups) {
      const statements = []
      for (const [tableName, payload] of Object.entries(rollups)) {
        const table = ROLLUP_TABLES_BY_NAME.get(tableName)
        if (!table || !payload) continue
        const deletes = payload.deleteKeys || []
        const rows = payload.rows || []
        for (const key of deletes) {
          const where = table.primaryKey.map((column) => `${column} = ?`).join(" AND ")
          statements.push({ sql: `DELETE FROM ${table.name} WHERE ${where}`, args: key })
        }
        if (rows.length > 0) {
          const sql = ROLLUP_UPSERTS.get(tableName)
          for (const row of rows) {
            statements.push({ sql, args: rowArgs(table, row) })
          }
        }
      }
      if (statements.length === 0) return
      await runInChunks(client, statements)
    },
    /**
     * Executes a raw query against Turso.
     *
     * @param {string} sql
     * @param {unknown[]} [args]
     * @returns {Promise<import("@libsql/client").ResultSet>}
     */
    async query(sql, args) {
      return client.execute(args ? { sql, args } : sql)
    },
    /**
     * Closes the underlying Turso client.
     *
     * @returns {Promise<void>}
     */
    async close() {
      client.close()
    },
  }
}
