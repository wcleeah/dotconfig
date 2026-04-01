/**
 * @typedef {import("./index").ColumnSpec} ColumnSpec
 * @typedef {import("./index").IndexSpec} IndexSpec
 * @typedef {import("./index").TableSpec} TableSpec
 */

export const SCHEMA_VERSION = 3

/**
 * Builds a column descriptor with a shared compact object shape.
 *
 * @param {string} name
 * @param {string} type
 * @param {{ notNull?: boolean, defaultValue?: string | number, primaryKey?: boolean }} [options]
 * @returns {ColumnSpec}
 */
function column(name, type, options = {}) {
  return {
    name,
    type,
    notNull: options.notNull ?? false,
    defaultValue: options.defaultValue,
    primaryKey: options.primaryKey ?? false,
  }
}

/**
 * Builds an index descriptor for a table.
 *
 * @param {string} name
 * @param {string[]} columns
 * @param {{ orders?: string[], unique?: boolean }} [options]
 * @returns {IndexSpec}
 */
function index(name, columns, options = {}) {
  return {
    name,
    columns,
    orders: options.orders ?? [],
    unique: options.unique ?? false,
  }
}

/**
 * Builds a table descriptor used for DDL generation and row serialization.
 *
 * @param {string} name
 * @param {ColumnSpec[]} columns
 * @param {IndexSpec[]} [indexes]
 * @returns {TableSpec}
 */
function table(name, columns, indexes = []) {
  return {
    name,
    columns,
    primaryKey: columns.filter((item) => item.primaryKey).map((item) => item.name),
    indexes,
  }
}

/**
 * Formats a SQL literal for DEFAULT clauses.
 *
 * @param {string | number | undefined} value
 * @returns {string}
 */
function sqlLiteral(value) {
  if (typeof value === "number") return String(value)
  return value
}

/**
 * Renders one column definition fragment for CREATE TABLE.
 *
 * Single-column primary keys are rendered inline. Composite primary keys are
 * emitted once at the end of the table definition.
 *
 * @param {ColumnSpec} definition
 * @param {boolean} inlinePrimaryKey
 * @returns {string}
 */
function columnDefinition(definition, inlinePrimaryKey) {
  const parts = [definition.name, definition.type]
  if (inlinePrimaryKey) parts.push("PRIMARY KEY")
  if (definition.notNull) parts.push("NOT NULL")
  if (definition.defaultValue !== undefined) parts.push(`DEFAULT ${sqlLiteral(definition.defaultValue)}`)
  return parts.join(" ")
}

/**
 * Renders a CREATE TABLE statement from table metadata.
 *
 * @param {TableSpec} definition
 * @returns {string}
 */
function createTableStatement(definition) {
  const inlinePrimaryKey = definition.primaryKey.length === 1 ? definition.primaryKey[0] : null
  const parts = definition.columns.map((item) => `      ${columnDefinition(item, item.name === inlinePrimaryKey)}`)
  if (definition.primaryKey.length > 1) {
    parts.push(`      PRIMARY KEY (${definition.primaryKey.join(", ")})`)
  }
  return `
    CREATE TABLE IF NOT EXISTS ${definition.name} (
${parts.join(",\n")}
    )
  `
}

/**
 * Renders a CREATE INDEX statement from index metadata.
 *
 * @param {TableSpec} definition
 * @param {IndexSpec} indexDefinition
 * @returns {string}
 */
function createIndexStatement(definition, indexDefinition) {
  const unique = indexDefinition.unique ? "UNIQUE " : ""
  const columns = indexDefinition.columns.map((name, position) => {
    const order = indexDefinition.orders[position]
    return order ? `${name} ${order}` : name
  })
  return `CREATE ${unique}INDEX IF NOT EXISTS ${indexDefinition.name} ON ${definition.name}(${columns.join(", ")})`
}

/** @type {TableSpec} */
export const SCHEMA_META_TABLE = table("schema_meta", [
  column("key", "TEXT", { primaryKey: true }),
  column("value", "TEXT", { notNull: true }),
  column("updated_at", "INTEGER", { notNull: true }),
])

export const TABLES = {
  projects: table(
    "projects",
    [
      column("id", "TEXT", { primaryKey: true }),
      column("worktree", "TEXT", { notNull: true }),
      column("vcs", "TEXT"),
      column("name", "TEXT"),
      column("icon_url", "TEXT"),
      column("icon_color", "TEXT"),
      column("time_created", "INTEGER", { notNull: true }),
      column("time_updated", "INTEGER", { notNull: true }),
      column("time_initialized", "INTEGER"),
    ],
  ),
  sessions: table(
    "sessions",
    [
      column("id", "TEXT", { primaryKey: true }),
      column("project_id", "TEXT", { notNull: true }),
      column("parent_session_id", "TEXT"),
      column("root_session_id", "TEXT", { notNull: true }),
      column("slug", "TEXT", { notNull: true }),
      column("directory", "TEXT", { notNull: true }),
      column("title", "TEXT", { notNull: true }),
      column("version", "TEXT", { notNull: true }),
      column("share_url", "TEXT"),
      column("summary_additions", "INTEGER", { notNull: true, defaultValue: 0 }),
      column("summary_deletions", "INTEGER", { notNull: true, defaultValue: 0 }),
      column("summary_files", "INTEGER", { notNull: true, defaultValue: 0 }),
      column("archived_at", "INTEGER"),
      column("deleted_at", "INTEGER"),
      column("time_created", "INTEGER", { notNull: true }),
      column("time_updated", "INTEGER", { notNull: true }),
    ],
    [
      index("idx_sessions_project", ["project_id", "time_updated"], { orders: ["ASC", "DESC"] }),
      index("idx_sessions_root", ["root_session_id"]),
    ],
  ),
  turns: table(
    "turns",
    [
      column("id", "TEXT", { primaryKey: true }),
      column("session_id", "TEXT", { notNull: true }),
      column("root_session_id", "TEXT", { notNull: true }),
      column("project_id", "TEXT", { notNull: true }),
      column("content", "TEXT"),
      column("synthetic", "INTEGER", { notNull: true, defaultValue: 0 }),
      column("compaction", "INTEGER", { notNull: true, defaultValue: 0 }),
      column("undone_at", "INTEGER"),
      column("time_created", "INTEGER", { notNull: true }),
      column("time_updated", "INTEGER", { notNull: true }),
      column("turn_duration_ms", "INTEGER"),
    ],
    [
      index("idx_turns_session", ["session_id", "time_created"]),
      index("idx_turns_root", ["root_session_id", "time_created"]),
      index("idx_turns_project", ["project_id", "time_created"]),
      index("idx_turns_undone", ["undone_at"]),
    ],
  ),
  responses: table(
    "responses",
    [
      column("id", "TEXT", { primaryKey: true }),
      column("turn_id", "TEXT", { notNull: true }),
      column("session_id", "TEXT", { notNull: true }),
      column("root_session_id", "TEXT", { notNull: true }),
      column("project_id", "TEXT", { notNull: true }),
      column("agent", "TEXT"),
      column("provider_id", "TEXT", { notNull: true }),
      column("model_id", "TEXT", { notNull: true }),
      column("summary", "INTEGER", { notNull: true, defaultValue: 0 }),
      column("finish", "TEXT"),
      column("error_type", "TEXT"),
      column("error_message", "TEXT"),
      column("cost", "REAL", { notNull: true, defaultValue: 0 }),
      column("tokens_in", "INTEGER", { notNull: true, defaultValue: 0 }),
      column("tokens_out", "INTEGER", { notNull: true, defaultValue: 0 }),
      column("tokens_reasoning", "INTEGER", { notNull: true, defaultValue: 0 }),
      column("tokens_cache_read", "INTEGER", { notNull: true, defaultValue: 0 }),
      column("tokens_cache_write", "INTEGER", { notNull: true, defaultValue: 0 }),
      column("time_created", "INTEGER", { notNull: true }),
      column("time_completed", "INTEGER"),
      column("response_time_ms", "INTEGER"),
    ],
    [
      index("idx_responses_turn", ["turn_id", "time_created"]),
      index("idx_responses_session", ["session_id", "time_created"]),
      index("idx_responses_root", ["root_session_id", "time_created"]),
      index("idx_responses_project", ["project_id", "time_created"]),
      index("idx_responses_model", ["model_id", "provider_id", "time_created"]),
    ],
  ),
  responseParts: table(
    "response_parts",
    [
      column("response_id", "TEXT", { notNull: true, primaryKey: true }),
      column("part_id", "TEXT", { notNull: true, primaryKey: true }),
      column("part_type", "TEXT", { notNull: true }),
      column("sort_key", "TEXT", { notNull: true }),
      column("content", "TEXT", { notNull: true }),
      column("size_bytes", "INTEGER", { notNull: true }),
    ],
    [index("idx_response_parts_response", ["response_id", "sort_key"])],
  ),
  llmSteps: table(
    "llm_steps",
    [
      column("id", "TEXT", { primaryKey: true }),
      column("response_id", "TEXT", { notNull: true }),
      column("session_id", "TEXT", { notNull: true }),
      column("root_session_id", "TEXT", { notNull: true }),
      column("project_id", "TEXT", { notNull: true }),
      column("provider_id", "TEXT", { notNull: true }),
      column("model_id", "TEXT", { notNull: true }),
      column("finish_reason", "TEXT"),
      column("cost", "REAL", { notNull: true, defaultValue: 0 }),
      column("tokens_in", "INTEGER", { notNull: true, defaultValue: 0 }),
      column("tokens_out", "INTEGER", { notNull: true, defaultValue: 0 }),
      column("tokens_reasoning", "INTEGER", { notNull: true, defaultValue: 0 }),
      column("tokens_cache_read", "INTEGER", { notNull: true, defaultValue: 0 }),
      column("tokens_cache_write", "INTEGER", { notNull: true, defaultValue: 0 }),
      column("time_created", "INTEGER", { notNull: true }),
      column("time_updated", "INTEGER", { notNull: true }),
    ],
    [index("idx_steps_response", ["response_id", "time_created"])],
  ),
  toolCalls: table(
    "tool_calls",
    [
      column("id", "TEXT", { primaryKey: true }),
      column("response_id", "TEXT", { notNull: true }),
      column("session_id", "TEXT", { notNull: true }),
      column("root_session_id", "TEXT", { notNull: true }),
      column("project_id", "TEXT", { notNull: true }),
      column("step_id", "TEXT"),
      column("call_id", "TEXT", { notNull: true }),
      column("tool", "TEXT", { notNull: true }),
      column("status", "TEXT", { notNull: true }),
      column("title", "TEXT"),
      column("error", "TEXT"),
      column("input_bytes", "INTEGER", { notNull: true, defaultValue: 0 }),
      column("output_bytes", "INTEGER", { notNull: true, defaultValue: 0 }),
      column("compacted_at", "INTEGER"),
      column("started_at", "INTEGER"),
      column("completed_at", "INTEGER"),
      column("duration_ms", "INTEGER"),
      column("time_updated", "INTEGER", { notNull: true }),
    ],
    [
      index("idx_tool_calls_response", ["response_id", "started_at"]),
      index("idx_tool_calls_session", ["session_id", "started_at"]),
      index("idx_tool_calls_root", ["root_session_id", "started_at"]),
      index("idx_tool_calls_project", ["project_id", "started_at"]),
      index("idx_tool_calls_tool", ["tool", "started_at"]),
    ],
  ),
  toolPayloads: table(
    "tool_payloads",
    [
      column("tool_call_id", "TEXT", { notNull: true, primaryKey: true }),
      column("payload_type", "TEXT", { notNull: true, primaryKey: true }),
      column("content", "TEXT", { notNull: true }),
      column("size_bytes", "INTEGER", { notNull: true }),
    ],
    [index("idx_tool_payloads_call", ["tool_call_id"])],
  ),
}

export const ROLLUP_TABLES = {
  sessionRollups: table("session_rollups", [
    column("session_id", "TEXT", { primaryKey: true }),
    column("root_session_id", "TEXT", { notNull: true }),
    column("project_id", "TEXT", { notNull: true }),
    column("session_count", "INTEGER", { notNull: true }),
    column("turn_count", "INTEGER", { notNull: true }),
    column("response_count", "INTEGER", { notNull: true }),
    column("total_tokens_in", "INTEGER", { notNull: true }),
    column("total_tokens_out", "INTEGER", { notNull: true }),
    column("total_tokens_reasoning", "INTEGER", { notNull: true }),
    column("total_tokens_cache_read", "INTEGER", { notNull: true }),
    column("total_tokens_cache_write", "INTEGER", { notNull: true }),
    column("reported_cost", "REAL", { notNull: true }),
    column("total_turn_wall_time_ms", "INTEGER", { notNull: true }),
    column("total_assistant_time_ms", "INTEGER", { notNull: true }),
    column("total_tool_time_ms", "INTEGER", { notNull: true }),
    column("total_tool_calls", "INTEGER", { notNull: true }),
    column("models_used", "INTEGER", { notNull: true }),
    column("last_activity", "INTEGER"),
    column("updated_at", "INTEGER", { notNull: true }),
  ]),
  sessionModelRollups: table("session_model_rollups", [
    column("session_id", "TEXT", { notNull: true, primaryKey: true }),
    column("model_id", "TEXT", { notNull: true, primaryKey: true }),
    column("provider_id", "TEXT", { notNull: true, primaryKey: true }),
    column("response_count", "INTEGER", { notNull: true }),
    column("total_tokens_in", "INTEGER", { notNull: true }),
    column("total_tokens_out", "INTEGER", { notNull: true }),
    column("total_tokens_reasoning", "INTEGER", { notNull: true }),
    column("total_tokens_cache_read", "INTEGER", { notNull: true }),
    column("total_tokens_cache_write", "INTEGER", { notNull: true }),
    column("reported_cost", "REAL", { notNull: true }),
  ]),
  projectRollups: table("project_rollups", [
    column("project_id", "TEXT", { primaryKey: true }),
    column("session_count", "INTEGER", { notNull: true }),
    column("turn_count", "INTEGER", { notNull: true }),
    column("response_count", "INTEGER", { notNull: true }),
    column("total_tokens_in", "INTEGER", { notNull: true }),
    column("total_tokens_out", "INTEGER", { notNull: true }),
    column("total_tokens_reasoning", "INTEGER", { notNull: true }),
    column("total_tokens_cache_read", "INTEGER", { notNull: true }),
    column("total_tokens_cache_write", "INTEGER", { notNull: true }),
    column("reported_cost", "REAL", { notNull: true }),
    column("total_turn_wall_time_ms", "INTEGER", { notNull: true }),
    column("total_assistant_time_ms", "INTEGER", { notNull: true }),
    column("total_tool_time_ms", "INTEGER", { notNull: true }),
    column("total_tool_calls", "INTEGER", { notNull: true }),
    column("models_used", "INTEGER", { notNull: true }),
    column("last_activity", "INTEGER"),
    column("updated_at", "INTEGER", { notNull: true }),
  ]),
  projectModelRollups: table("project_model_rollups", [
    column("project_id", "TEXT", { notNull: true, primaryKey: true }),
    column("model_id", "TEXT", { notNull: true, primaryKey: true }),
    column("provider_id", "TEXT", { notNull: true, primaryKey: true }),
    column("response_count", "INTEGER", { notNull: true }),
    column("total_tokens_in", "INTEGER", { notNull: true }),
    column("total_tokens_out", "INTEGER", { notNull: true }),
    column("total_tokens_reasoning", "INTEGER", { notNull: true }),
    column("total_tokens_cache_read", "INTEGER", { notNull: true }),
    column("total_tokens_cache_write", "INTEGER", { notNull: true }),
    column("reported_cost", "REAL", { notNull: true }),
  ]),
  toolRollups: table("tool_rollups", [
    column("tool", "TEXT", { primaryKey: true }),
    column("call_count", "INTEGER", { notNull: true }),
    column("error_count", "INTEGER", { notNull: true }),
    column("total_duration_ms", "INTEGER", { notNull: true }),
    column("avg_duration_ms", "INTEGER", { notNull: true }),
    column("max_duration_ms", "INTEGER", { notNull: true }),
    column("total_input_bytes", "INTEGER", { notNull: true }),
    column("total_output_bytes", "INTEGER", { notNull: true }),
    column("last_called_at", "INTEGER"),
    column("updated_at", "INTEGER", { notNull: true }),
  ]),
  dailyGlobalRollups: table("daily_global_rollups", [
    column("day", "TEXT", { primaryKey: true }),
    column("turn_count", "INTEGER", { notNull: true }),
    column("response_count", "INTEGER", { notNull: true }),
    column("tool_call_count", "INTEGER", { notNull: true }),
    column("error_count", "INTEGER", { notNull: true }),
    column("total_tokens_in", "INTEGER", { notNull: true }),
    column("total_tokens_out", "INTEGER", { notNull: true }),
    column("total_tokens_reasoning", "INTEGER", { notNull: true }),
    column("total_tokens_cache_read", "INTEGER", { notNull: true }),
    column("total_tokens_cache_write", "INTEGER", { notNull: true }),
    column("reported_cost", "REAL", { notNull: true }),
    column("total_turn_wall_time_ms", "INTEGER", { notNull: true }),
    column("total_assistant_time_ms", "INTEGER", { notNull: true }),
    column("total_tool_time_ms", "INTEGER", { notNull: true }),
    column("max_turn_wall_time_ms", "INTEGER", { notNull: true }),
    column("max_assistant_time_ms", "INTEGER", { notNull: true }),
    column("max_tool_duration_ms", "INTEGER", { notNull: true }),
    column("updated_at", "INTEGER", { notNull: true }),
  ]),
  dailyModelRollups: table("daily_model_rollups", [
    column("day", "TEXT", { notNull: true, primaryKey: true }),
    column("model_id", "TEXT", { notNull: true, primaryKey: true }),
    column("provider_id", "TEXT", { notNull: true, primaryKey: true }),
    column("response_count", "INTEGER", { notNull: true }),
    column("error_count", "INTEGER", { notNull: true }),
    column("total_tokens_in", "INTEGER", { notNull: true }),
    column("total_tokens_out", "INTEGER", { notNull: true }),
    column("total_tokens_reasoning", "INTEGER", { notNull: true }),
    column("total_tokens_cache_read", "INTEGER", { notNull: true }),
    column("total_tokens_cache_write", "INTEGER", { notNull: true }),
    column("reported_cost", "REAL", { notNull: true }),
    column("updated_at", "INTEGER", { notNull: true }),
  ]),
  dailyToolRollups: table("daily_tool_rollups", [
    column("day", "TEXT", { notNull: true, primaryKey: true }),
    column("tool", "TEXT", { notNull: true, primaryKey: true }),
    column("call_count", "INTEGER", { notNull: true }),
    column("error_count", "INTEGER", { notNull: true }),
    column("total_duration_ms", "INTEGER", { notNull: true }),
    column("avg_duration_ms", "INTEGER", { notNull: true }),
    column("max_duration_ms", "INTEGER", { notNull: true }),
    column("total_input_bytes", "INTEGER", { notNull: true }),
    column("total_output_bytes", "INTEGER", { notNull: true }),
    column("updated_at", "INTEGER", { notNull: true }),
  ]),
  dailyProjectRollups: table("daily_project_rollups", [
    column("day", "TEXT", { notNull: true, primaryKey: true }),
    column("project_id", "TEXT", { notNull: true, primaryKey: true }),
    column("turn_count", "INTEGER", { notNull: true }),
    column("response_count", "INTEGER", { notNull: true }),
    column("error_count", "INTEGER", { notNull: true }),
    column("total_tokens_in", "INTEGER", { notNull: true }),
    column("total_tokens_out", "INTEGER", { notNull: true }),
    column("total_tokens_reasoning", "INTEGER", { notNull: true }),
    column("total_tokens_cache_read", "INTEGER", { notNull: true }),
    column("total_tokens_cache_write", "INTEGER", { notNull: true }),
    column("reported_cost", "REAL", { notNull: true }),
    column("total_turn_wall_time_ms", "INTEGER", { notNull: true }),
    column("total_assistant_time_ms", "INTEGER", { notNull: true }),
    column("total_tool_time_ms", "INTEGER", { notNull: true }),
    column("max_turn_wall_time_ms", "INTEGER", { notNull: true }),
    column("max_assistant_time_ms", "INTEGER", { notNull: true }),
    column("max_tool_duration_ms", "INTEGER", { notNull: true }),
    column("updated_at", "INTEGER", { notNull: true }),
  ]),
}

export const FACT_TABLE_ORDER = [
  TABLES.projects,
  TABLES.sessions,
  TABLES.turns,
  TABLES.responses,
  TABLES.responseParts,
  TABLES.llmSteps,
  TABLES.toolCalls,
  TABLES.toolPayloads,
]

/** @type {TableSpec[]} */
export const ALL_TABLES = [
  SCHEMA_META_TABLE,
  ...FACT_TABLE_ORDER,
  ...Object.values(ROLLUP_TABLES),
]

export const CREATE_STATEMENTS = ALL_TABLES.map(createTableStatement)

export const INDEX_STATEMENTS = ALL_TABLES.flatMap((definition) => definition.indexes.map((item) => createIndexStatement(definition, item)))

/**
 * Builds an idempotent upsert statement for a table definition.
 *
 * The statement inserts every declared column and, on primary-key conflict,
 * updates every non-primary-key column from SQLite's `excluded` pseudo-table.
 *
 * Example shape:
 * `INSERT INTO turns (...) VALUES (...) ON CONFLICT(id) DO UPDATE SET content = excluded.content, ...`
 *
 * @param {TableSpec} definition
 * @returns {string}
 */
export function makeUpsertStatement(definition) {
  const placeholders = definition.columns.map(() => "?").join(", ")
  const updates = definition.columns
    .filter((item) => !definition.primaryKey.includes(item.name))
    .map((item) => `${item.name} = excluded.${item.name}`)
    .join(", ")
  return `INSERT INTO ${definition.name} (${definition.columns.map((item) => item.name).join(", ")}) VALUES (${placeholders}) ON CONFLICT(${definition.primaryKey.join(", ")}) DO UPDATE SET ${updates}`
}

/**
 * Serializes a row object into ordered SQL arguments for the given table.
 *
 * @param {TableSpec} definition
 * @param {Record<string, unknown>} row
 * @returns {unknown[]}
 */
export function rowArgs(definition, row) {
  return definition.columns.map((item) => row[item.name] ?? null)
}

/**
 * Builds a stable string key from a row's primary-key columns.
 *
 * @param {string} tableName
 * @param {Record<string, unknown>} row
 * @returns {string}
 */
export function primaryKeyValue(tableName, row) {
  const definition = ALL_TABLES.find((item) => item.name === tableName)
  if (!definition) throw new Error(`Unknown table: ${tableName}`)
  return definition.primaryKey.map((columnName) => row[columnName] ?? null).join("::")
}

/**
 * Normalizes missing model ids into a stable analytics bucket.
 *
 * @param {string | null | undefined} value
 * @returns {string}
 */
export function normalizeModelID(value) {
  return value || "_unknown"
}

/**
 * Normalizes missing provider ids into a stable analytics bucket.
 *
 * @param {string | null | undefined} value
 * @returns {string}
 */
export function normalizeProviderID(value) {
  return value || "_unknown"
}

/**
 * Formats a timestamp as a UTC analytics day key.
 *
 * @param {number} timestamp
 * @returns {string}
 */
export function formatDay(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10)
}

/**
 * Returns the current epoch time in milliseconds.
 *
 * @returns {number}
 */
export function nowValue() {
  return Date.now()
}
