import { nowValue } from "./schema.js"

/**
 * Converts the first row of a libsql result into a plain object.
 *
 * @param {{ rows: Array<Record<string, unknown>>, columns: string[] }} result
 * @returns {Record<string, unknown> | null}
 */
function rowObject(result) {
  const row = result.rows[0]
  if (!row) return null
  const output = {}
  for (const column of result.columns) {
    output[column] = row[column]
  }
  return output
}

/**
 * Executes a query and converts all rows into plain objects.
 *
 * @param {{ query(sql: string, args?: unknown[]): Promise<{ rows: Array<Record<string, unknown>>, columns: string[] }> }} turso
 * @param {string} sql
 * @param {unknown[]} args
 * @returns {Promise<Record<string, unknown>[]>}
 */
async function queryRows(turso, sql, args) {
  const result = await turso.query(sql, args)
  return result.rows.map((row) => {
    const output = {}
    for (const column of result.columns) {
      output[column] = row[column]
    }
    return output
  })
}

/**
 * Executes a query and returns the first row as a plain object.
 *
 * @param {{ query(sql: string, args?: unknown[]): Promise<{ rows: Array<Record<string, unknown>>, columns: string[] }> }} turso
 * @param {string} sql
 * @param {unknown[]} args
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function queryOne(turso, sql, args) {
  const result = await turso.query(sql, args)
  return rowObject(result)
}

/**
 * SQL predicate used for user-turn wall-time metrics.
 *
 * @param {string} [prefix]
 * @returns {string}
 */
function turnWallTimeFilter(prefix = "") {
  return `${prefix}synthetic = 0 AND ${prefix}compaction = 0`
}

/**
 * SQL fragment that safely sums tool durations.
 *
 * @param {string} [prefix]
 * @returns {string}
 */
function toolDurationSql(prefix = "") {
  return `COALESCE(SUM(CASE WHEN ${prefix}duration_ms IS NOT NULL THEN ${prefix}duration_ms ELSE 0 END), 0)`
}

/**
 * Recomputes session subtree rollups for touched sessions.
 *
 * @param {any} turso
 * @param {string[]} sessionIDs
 * @returns {Promise<{ rows: Record<string, unknown>[], deleteKeys: unknown[][] }>}
 */
async function recomputeSessionRollups(turso, sessionIDs) {
  const rows = []
  const deleteKeys = []

  for (const sessionID of sessionIDs) {
    const session = await queryOne(
      turso,
      `SELECT id, root_session_id, project_id FROM sessions WHERE id = ? AND deleted_at IS NULL`,
      [sessionID],
    )
    if (!session) {
      deleteKeys.push([sessionID])
      continue
    }
    const rollup = await queryOne(
      turso,
      `
        WITH RECURSIVE subtree AS (
          SELECT id FROM sessions WHERE id = ? AND deleted_at IS NULL
          UNION ALL
          SELECT s.id
          FROM sessions s
          JOIN subtree ON s.parent_session_id = subtree.id
          WHERE s.deleted_at IS NULL
        ),
        turn_stats AS (
          SELECT
            COUNT(*) FILTER (WHERE ${turnWallTimeFilter()}) AS turn_count,
            COALESCE(SUM(CASE WHEN ${turnWallTimeFilter()} THEN turn_duration_ms ELSE 0 END), 0) AS total_turn_wall_time_ms,
            MAX(time_updated) AS turn_last_activity
          FROM turns
          WHERE session_id IN (SELECT id FROM subtree)
        ),
        response_stats AS (
          SELECT
            COUNT(*) AS response_count,
            COALESCE(SUM(tokens_in), 0) AS total_tokens_in,
            COALESCE(SUM(tokens_out), 0) AS total_tokens_out,
            COALESCE(SUM(tokens_reasoning), 0) AS total_tokens_reasoning,
            COALESCE(SUM(tokens_cache_read), 0) AS total_tokens_cache_read,
            COALESCE(SUM(tokens_cache_write), 0) AS total_tokens_cache_write,
            COALESCE(SUM(cost), 0) AS reported_cost,
            COALESCE(SUM(response_time_ms), 0) AS total_assistant_time_ms,
            COUNT(DISTINCT model_id) AS models_used,
            MAX(COALESCE(time_completed, time_created)) AS response_last_activity
          FROM responses
          WHERE session_id IN (SELECT id FROM subtree)
        ),
        tool_stats AS (
          SELECT
            COUNT(*) AS total_tool_calls,
            ${toolDurationSql()} AS total_tool_time_ms,
            MAX(COALESCE(completed_at, started_at, time_updated)) AS tool_last_activity
          FROM tool_calls
          WHERE session_id IN (SELECT id FROM subtree)
        )
        SELECT
          ? AS session_id,
          ? AS root_session_id,
          ? AS project_id,
          (SELECT COUNT(*) FROM subtree) AS session_count,
          COALESCE(turn_stats.turn_count, 0) AS turn_count,
          COALESCE(response_stats.response_count, 0) AS response_count,
          COALESCE(response_stats.total_tokens_in, 0) AS total_tokens_in,
          COALESCE(response_stats.total_tokens_out, 0) AS total_tokens_out,
          COALESCE(response_stats.total_tokens_reasoning, 0) AS total_tokens_reasoning,
          COALESCE(response_stats.total_tokens_cache_read, 0) AS total_tokens_cache_read,
          COALESCE(response_stats.total_tokens_cache_write, 0) AS total_tokens_cache_write,
          COALESCE(response_stats.reported_cost, 0) AS reported_cost,
          COALESCE(turn_stats.total_turn_wall_time_ms, 0) AS total_turn_wall_time_ms,
          COALESCE(response_stats.total_assistant_time_ms, 0) AS total_assistant_time_ms,
          COALESCE(tool_stats.total_tool_time_ms, 0) AS total_tool_time_ms,
          COALESCE(tool_stats.total_tool_calls, 0) AS total_tool_calls,
          COALESCE(response_stats.models_used, 0) AS models_used,
          NULLIF(MAX(
            COALESCE((SELECT MAX(s2.time_updated) FROM sessions s2 WHERE s2.id IN (SELECT id FROM subtree)), 0),
            COALESCE(turn_stats.turn_last_activity, 0),
            COALESCE(response_stats.response_last_activity, 0),
            COALESCE(tool_stats.tool_last_activity, 0)
          ), 0) AS last_activity,
          ? AS updated_at
        FROM turn_stats, response_stats, tool_stats
      `,
      [session.id, session.id, session.root_session_id, session.project_id, nowValue()],
    )
    rows.push(rollup)
  }

  return { rows, deleteKeys }
}

/**
 * Recomputes per-model session subtree rollups.
 *
 * @param {any} turso
 * @param {string[]} sessionIDs
 * @returns {Promise<{ rows: Record<string, unknown>[], deleteKeys: unknown[][] }>}
 */
async function recomputeSessionModelRollups(turso, sessionIDs) {
  const rows = []
  const deleteKeys = []
  for (const sessionID of sessionIDs) {
    const existing = await queryRows(
      turso,
      `
        SELECT session_id, model_id, provider_id
        FROM session_model_rollups
        WHERE session_id = ?
      `,
      [sessionID],
    )
    deleteKeys.push(...existing.map((row) => [row.session_id, row.model_id, row.provider_id]))
    const session = await queryOne(turso, `SELECT id FROM sessions WHERE id = ? AND deleted_at IS NULL`, [sessionID])
    if (!session) continue
    const result = await queryRows(
      turso,
      `
        WITH RECURSIVE subtree AS (
          SELECT id FROM sessions WHERE id = ? AND deleted_at IS NULL
          UNION ALL
          SELECT s.id
          FROM sessions s
          JOIN subtree ON s.parent_session_id = subtree.id
          WHERE s.deleted_at IS NULL
        )
        SELECT
          ? AS session_id,
          model_id,
          provider_id,
          COUNT(*) AS response_count,
          COALESCE(SUM(tokens_in), 0) AS total_tokens_in,
          COALESCE(SUM(tokens_out), 0) AS total_tokens_out,
          COALESCE(SUM(tokens_reasoning), 0) AS total_tokens_reasoning,
          COALESCE(SUM(tokens_cache_read), 0) AS total_tokens_cache_read,
          COALESCE(SUM(tokens_cache_write), 0) AS total_tokens_cache_write,
          COALESCE(SUM(cost), 0) AS reported_cost
        FROM responses
        WHERE session_id IN (SELECT id FROM subtree)
        GROUP BY model_id, provider_id
      `,
      [sessionID, sessionID],
    )
    rows.push(...result)
  }
  return { rows, deleteKeys }
}

/**
 * Recomputes project-level rollups for touched projects.
 *
 * @param {any} turso
 * @param {string[]} projectIDs
 * @returns {Promise<{ rows: Record<string, unknown>[], deleteKeys: unknown[][] }>}
 */
async function recomputeProjectRollups(turso, projectIDs) {
  const rows = []
  const deleteKeys = []
  for (const projectID of projectIDs) {
    const project = await queryOne(turso, `SELECT id FROM projects WHERE id = ?`, [projectID])
    if (!project) {
      deleteKeys.push([projectID])
      continue
    }
    const row = await queryOne(
      turso,
      `
        WITH session_stats AS (
          SELECT
            COUNT(*) FILTER (WHERE parent_session_id IS NULL) AS session_count,
            MAX(time_updated) AS session_last_activity
          FROM sessions
          WHERE project_id = ? AND deleted_at IS NULL
        ),
        turn_stats AS (
          SELECT
            COUNT(*) FILTER (WHERE ${turnWallTimeFilter()}) AS turn_count,
            COALESCE(SUM(CASE WHEN ${turnWallTimeFilter()} THEN turn_duration_ms ELSE 0 END), 0) AS total_turn_wall_time_ms,
            MAX(time_updated) AS turn_last_activity
          FROM turns
          WHERE project_id = ?
        ),
        response_stats AS (
          SELECT
            COUNT(*) AS response_count,
            COALESCE(SUM(tokens_in), 0) AS total_tokens_in,
            COALESCE(SUM(tokens_out), 0) AS total_tokens_out,
            COALESCE(SUM(tokens_reasoning), 0) AS total_tokens_reasoning,
            COALESCE(SUM(tokens_cache_read), 0) AS total_tokens_cache_read,
            COALESCE(SUM(tokens_cache_write), 0) AS total_tokens_cache_write,
            COALESCE(SUM(cost), 0) AS reported_cost,
            COALESCE(SUM(response_time_ms), 0) AS total_assistant_time_ms,
            COUNT(DISTINCT model_id) AS models_used,
            MAX(COALESCE(time_completed, time_created)) AS response_last_activity
          FROM responses
          WHERE project_id = ?
        ),
        tool_stats AS (
          SELECT
            COUNT(*) AS total_tool_calls,
            ${toolDurationSql()} AS total_tool_time_ms,
            MAX(COALESCE(completed_at, started_at, time_updated)) AS tool_last_activity
          FROM tool_calls
          WHERE project_id = ?
        )
        SELECT
          ? AS project_id,
          COALESCE(session_stats.session_count, 0) AS session_count,
          COALESCE(turn_stats.turn_count, 0) AS turn_count,
          COALESCE(response_stats.response_count, 0) AS response_count,
          COALESCE(response_stats.total_tokens_in, 0) AS total_tokens_in,
          COALESCE(response_stats.total_tokens_out, 0) AS total_tokens_out,
          COALESCE(response_stats.total_tokens_reasoning, 0) AS total_tokens_reasoning,
          COALESCE(response_stats.total_tokens_cache_read, 0) AS total_tokens_cache_read,
          COALESCE(response_stats.total_tokens_cache_write, 0) AS total_tokens_cache_write,
          COALESCE(response_stats.reported_cost, 0) AS reported_cost,
          COALESCE(turn_stats.total_turn_wall_time_ms, 0) AS total_turn_wall_time_ms,
          COALESCE(response_stats.total_assistant_time_ms, 0) AS total_assistant_time_ms,
          COALESCE(tool_stats.total_tool_time_ms, 0) AS total_tool_time_ms,
          COALESCE(tool_stats.total_tool_calls, 0) AS total_tool_calls,
          COALESCE(response_stats.models_used, 0) AS models_used,
          NULLIF(MAX(
            COALESCE(session_stats.session_last_activity, 0),
            COALESCE(turn_stats.turn_last_activity, 0),
            COALESCE(response_stats.response_last_activity, 0),
            COALESCE(tool_stats.tool_last_activity, 0)
          ), 0) AS last_activity,
          ? AS updated_at
        FROM session_stats, turn_stats, response_stats, tool_stats
      `,
      [projectID, projectID, projectID, projectID, projectID, nowValue()],
    )
    rows.push(row)
  }
  return { rows, deleteKeys }
}

/**
 * Recomputes per-model project rollups.
 *
 * @param {any} turso
 * @param {string[]} projectIDs
 * @returns {Promise<{ rows: Record<string, unknown>[], deleteKeys: unknown[][] }>}
 */
async function recomputeProjectModelRollups(turso, projectIDs) {
  const rows = []
  const deleteKeys = []
  for (const projectID of projectIDs) {
    const existing = await queryRows(
      turso,
      `
        SELECT project_id, model_id, provider_id
        FROM project_model_rollups
        WHERE project_id = ?
      `,
      [projectID],
    )
    deleteKeys.push(...existing.map((row) => [row.project_id, row.model_id, row.provider_id]))
    const result = await queryRows(
      turso,
      `
        SELECT
          ? AS project_id,
          model_id,
          provider_id,
          COUNT(*) AS response_count,
          COALESCE(SUM(tokens_in), 0) AS total_tokens_in,
          COALESCE(SUM(tokens_out), 0) AS total_tokens_out,
          COALESCE(SUM(tokens_reasoning), 0) AS total_tokens_reasoning,
          COALESCE(SUM(tokens_cache_read), 0) AS total_tokens_cache_read,
          COALESCE(SUM(tokens_cache_write), 0) AS total_tokens_cache_write,
          COALESCE(SUM(cost), 0) AS reported_cost
        FROM responses
        WHERE project_id = ?
        GROUP BY model_id, provider_id
      `,
      [projectID, projectID],
    )
    rows.push(...result)
  }
  return { rows, deleteKeys }
}

/**
 * Recomputes global tool rollups.
 *
 * @param {any} turso
 * @param {string[]} tools
 * @returns {Promise<{ rows: Record<string, unknown>[], deleteKeys: unknown[][] }>}
 */
async function recomputeToolRollups(turso, tools) {
  const rows = []
  const deleteKeys = []
  for (const tool of tools) {
    deleteKeys.push([tool])
    const row = await queryOne(
      turso,
      `
        SELECT
          ? AS tool,
          COUNT(*) AS call_count,
          SUM(CASE WHEN status = 'error' OR error IS NOT NULL THEN 1 ELSE 0 END) AS error_count,
          ${toolDurationSql()} AS total_duration_ms,
          COALESCE(ROUND(AVG(duration_ms)), 0) AS avg_duration_ms,
          COALESCE(MAX(duration_ms), 0) AS max_duration_ms,
          COALESCE(SUM(input_bytes), 0) AS total_input_bytes,
          COALESCE(SUM(output_bytes), 0) AS total_output_bytes,
          NULLIF(MAX(COALESCE(completed_at, started_at, time_updated)), 0) AS last_called_at,
          ? AS updated_at
        FROM tool_calls
        WHERE tool = ?
      `,
      [tool, nowValue(), tool],
    )
    if ((row?.call_count ?? 0) === 0) continue
    rows.push(row)
  }
  return { rows, deleteKeys }
}

/**
 * Recomputes daily global rollups.
 *
 * @param {any} turso
 * @param {string[]} days
 * @returns {Promise<{ rows: Record<string, unknown>[], deleteKeys: unknown[][] }>}
 */
async function recomputeDailyGlobalRollups(turso, days) {
  const rows = []
  const deleteKeys = []
  for (const day of days) {
    deleteKeys.push([day])
    const row = await queryOne(
      turso,
      `
        WITH turn_stats AS (
          SELECT
            COUNT(*) FILTER (WHERE ${turnWallTimeFilter()}) AS turn_count,
            COALESCE(SUM(CASE WHEN ${turnWallTimeFilter()} THEN turn_duration_ms ELSE 0 END), 0) AS total_turn_wall_time_ms,
            COALESCE(MAX(CASE WHEN ${turnWallTimeFilter()} THEN turn_duration_ms ELSE 0 END), 0) AS max_turn_wall_time_ms
          FROM turns
          WHERE date(time_created / 1000, 'unixepoch') = ?
        ),
        response_stats AS (
          SELECT
            COUNT(*) AS response_count,
            SUM(CASE WHEN error_type IS NOT NULL THEN 1 ELSE 0 END) AS error_count,
            COALESCE(SUM(tokens_in), 0) AS total_tokens_in,
            COALESCE(SUM(tokens_out), 0) AS total_tokens_out,
            COALESCE(SUM(tokens_reasoning), 0) AS total_tokens_reasoning,
            COALESCE(SUM(tokens_cache_read), 0) AS total_tokens_cache_read,
            COALESCE(SUM(tokens_cache_write), 0) AS total_tokens_cache_write,
            COALESCE(SUM(cost), 0) AS reported_cost,
            COALESCE(SUM(response_time_ms), 0) AS total_assistant_time_ms,
            COALESCE(MAX(response_time_ms), 0) AS max_assistant_time_ms
          FROM responses
          WHERE date(time_created / 1000, 'unixepoch') = ?
        ),
        tool_stats AS (
          SELECT
            COUNT(*) AS tool_call_count,
            ${toolDurationSql()} AS total_tool_time_ms,
            COALESCE(MAX(duration_ms), 0) AS max_tool_duration_ms
          FROM tool_calls
          WHERE date(COALESCE(started_at, time_updated) / 1000, 'unixepoch') = ?
        )
        SELECT
          ? AS day,
          COALESCE(turn_stats.turn_count, 0) AS turn_count,
          COALESCE(response_stats.response_count, 0) AS response_count,
          COALESCE(tool_stats.tool_call_count, 0) AS tool_call_count,
          COALESCE(response_stats.error_count, 0) AS error_count,
          COALESCE(response_stats.total_tokens_in, 0) AS total_tokens_in,
          COALESCE(response_stats.total_tokens_out, 0) AS total_tokens_out,
          COALESCE(response_stats.total_tokens_reasoning, 0) AS total_tokens_reasoning,
          COALESCE(response_stats.total_tokens_cache_read, 0) AS total_tokens_cache_read,
          COALESCE(response_stats.total_tokens_cache_write, 0) AS total_tokens_cache_write,
          COALESCE(response_stats.reported_cost, 0) AS reported_cost,
          COALESCE(turn_stats.total_turn_wall_time_ms, 0) AS total_turn_wall_time_ms,
          COALESCE(response_stats.total_assistant_time_ms, 0) AS total_assistant_time_ms,
          COALESCE(tool_stats.total_tool_time_ms, 0) AS total_tool_time_ms,
          COALESCE(turn_stats.max_turn_wall_time_ms, 0) AS max_turn_wall_time_ms,
          COALESCE(response_stats.max_assistant_time_ms, 0) AS max_assistant_time_ms,
          COALESCE(tool_stats.max_tool_duration_ms, 0) AS max_tool_duration_ms,
          ? AS updated_at
        FROM turn_stats, response_stats, tool_stats
      `,
      [day, day, day, day, nowValue()],
    )
    rows.push(row)
  }
  return { rows, deleteKeys }
}

/**
 * Recomputes daily model rollups.
 *
 * @param {any} turso
 * @param {Array<[string, string, string]>} modelKeys
 * @returns {Promise<{ rows: Record<string, unknown>[], deleteKeys: unknown[][] }>}
 */
async function recomputeDailyModelRollups(turso, modelKeys) {
  const rows = []
  const deleteKeys = []
  for (const [day, modelID, providerID] of modelKeys) {
    deleteKeys.push([day, modelID, providerID])
    const row = await queryOne(
      turso,
      `
        SELECT
          ? AS day,
          ? AS model_id,
          ? AS provider_id,
          COUNT(*) AS response_count,
          SUM(CASE WHEN error_type IS NOT NULL THEN 1 ELSE 0 END) AS error_count,
          COALESCE(SUM(tokens_in), 0) AS total_tokens_in,
          COALESCE(SUM(tokens_out), 0) AS total_tokens_out,
          COALESCE(SUM(tokens_reasoning), 0) AS total_tokens_reasoning,
          COALESCE(SUM(tokens_cache_read), 0) AS total_tokens_cache_read,
          COALESCE(SUM(tokens_cache_write), 0) AS total_tokens_cache_write,
          COALESCE(SUM(cost), 0) AS reported_cost,
          ? AS updated_at
        FROM responses
        WHERE date(time_created / 1000, 'unixepoch') = ?
          AND model_id = ?
          AND provider_id = ?
      `,
      [day, modelID, providerID, nowValue(), day, modelID, providerID],
    )
    if ((row?.response_count ?? 0) === 0) continue
    rows.push(row)
  }
  return { rows, deleteKeys }
}

/**
 * Recomputes daily tool rollups.
 *
 * @param {any} turso
 * @param {Array<[string, string]>} toolKeys
 * @returns {Promise<{ rows: Record<string, unknown>[], deleteKeys: unknown[][] }>}
 */
async function recomputeDailyToolRollups(turso, toolKeys) {
  const rows = []
  const deleteKeys = []
  for (const [day, tool] of toolKeys) {
    deleteKeys.push([day, tool])
    const row = await queryOne(
      turso,
      `
        SELECT
          ? AS day,
          ? AS tool,
          COUNT(*) AS call_count,
          SUM(CASE WHEN status = 'error' OR error IS NOT NULL THEN 1 ELSE 0 END) AS error_count,
          ${toolDurationSql()} AS total_duration_ms,
          COALESCE(ROUND(AVG(duration_ms)), 0) AS avg_duration_ms,
          COALESCE(MAX(duration_ms), 0) AS max_duration_ms,
          COALESCE(SUM(input_bytes), 0) AS total_input_bytes,
          COALESCE(SUM(output_bytes), 0) AS total_output_bytes,
          ? AS updated_at
        FROM tool_calls
        WHERE date(COALESCE(started_at, time_updated) / 1000, 'unixepoch') = ?
          AND tool = ?
      `,
      [day, tool, nowValue(), day, tool],
    )
    if ((row?.call_count ?? 0) === 0) continue
    rows.push(row)
  }
  return { rows, deleteKeys }
}

/**
 * Recomputes daily per-project rollups.
 *
 * @param {any} turso
 * @param {Array<[string, string]>} projectDayKeys
 * @returns {Promise<{ rows: Record<string, unknown>[], deleteKeys: unknown[][] }>}
 */
async function recomputeDailyProjectRollups(turso, projectDayKeys) {
  const rows = []
  const deleteKeys = []
  for (const [day, projectID] of projectDayKeys) {
    deleteKeys.push([day, projectID])
    const row = await queryOne(
      turso,
      `
        WITH turn_stats AS (
          SELECT
            COUNT(*) FILTER (WHERE ${turnWallTimeFilter()}) AS turn_count,
            COALESCE(SUM(CASE WHEN ${turnWallTimeFilter()} THEN turn_duration_ms ELSE 0 END), 0) AS total_turn_wall_time_ms,
            COALESCE(MAX(CASE WHEN ${turnWallTimeFilter()} THEN turn_duration_ms ELSE 0 END), 0) AS max_turn_wall_time_ms
          FROM turns
          WHERE project_id = ?
            AND date(time_created / 1000, 'unixepoch') = ?
        ),
        response_stats AS (
          SELECT
            COUNT(*) AS response_count,
            SUM(CASE WHEN error_type IS NOT NULL THEN 1 ELSE 0 END) AS error_count,
            COALESCE(SUM(tokens_in), 0) AS total_tokens_in,
            COALESCE(SUM(tokens_out), 0) AS total_tokens_out,
            COALESCE(SUM(tokens_reasoning), 0) AS total_tokens_reasoning,
            COALESCE(SUM(tokens_cache_read), 0) AS total_tokens_cache_read,
            COALESCE(SUM(tokens_cache_write), 0) AS total_tokens_cache_write,
            COALESCE(SUM(cost), 0) AS reported_cost,
            COALESCE(SUM(response_time_ms), 0) AS total_assistant_time_ms,
            COALESCE(MAX(response_time_ms), 0) AS max_assistant_time_ms
          FROM responses
          WHERE project_id = ?
            AND date(time_created / 1000, 'unixepoch') = ?
        ),
        tool_stats AS (
          SELECT
            COUNT(*) AS tool_call_count,
            ${toolDurationSql()} AS total_tool_time_ms,
            COALESCE(MAX(duration_ms), 0) AS max_tool_duration_ms
          FROM tool_calls
          WHERE project_id = ?
            AND date(COALESCE(started_at, time_updated) / 1000, 'unixepoch') = ?
        )
        SELECT
          ? AS day,
          ? AS project_id,
          COALESCE(turn_stats.turn_count, 0) AS turn_count,
          COALESCE(response_stats.response_count, 0) AS response_count,
          COALESCE(response_stats.error_count, 0) AS error_count,
          COALESCE(response_stats.total_tokens_in, 0) AS total_tokens_in,
          COALESCE(response_stats.total_tokens_out, 0) AS total_tokens_out,
          COALESCE(response_stats.total_tokens_reasoning, 0) AS total_tokens_reasoning,
          COALESCE(response_stats.total_tokens_cache_read, 0) AS total_tokens_cache_read,
          COALESCE(response_stats.total_tokens_cache_write, 0) AS total_tokens_cache_write,
          COALESCE(response_stats.reported_cost, 0) AS reported_cost,
          COALESCE(turn_stats.total_turn_wall_time_ms, 0) AS total_turn_wall_time_ms,
          COALESCE(response_stats.total_assistant_time_ms, 0) AS total_assistant_time_ms,
          COALESCE(tool_stats.total_tool_time_ms, 0) AS total_tool_time_ms,
          COALESCE(turn_stats.max_turn_wall_time_ms, 0) AS max_turn_wall_time_ms,
          COALESCE(response_stats.max_assistant_time_ms, 0) AS max_assistant_time_ms,
          COALESCE(tool_stats.max_tool_duration_ms, 0) AS max_tool_duration_ms,
          ? AS updated_at
        FROM turn_stats, response_stats, tool_stats
      `,
      [projectID, day, projectID, day, projectID, day, day, projectID, nowValue()],
    )
    const toolCount = await queryOne(
      turso,
      `
        SELECT COUNT(*) AS tool_call_count
        FROM tool_calls
        WHERE project_id = ?
          AND date(COALESCE(started_at, time_updated) / 1000, 'unixepoch') = ?
      `,
      [projectID, day],
    )
    const turnCount = await queryOne(
      turso,
      `
        SELECT COUNT(*) AS turn_row_count
        FROM turns
        WHERE project_id = ?
          AND date(time_created / 1000, 'unixepoch') = ?
      `,
      [projectID, day],
    )
    if (
      (turnCount?.turn_row_count ?? 0) === 0 &&
      (row?.response_count ?? 0) === 0 &&
      (toolCount?.tool_call_count ?? 0) === 0
    ) continue
    rows.push(row)
  }
  return { rows, deleteKeys }
}

/**
 * Recomputes every rollup family touched by a normalized event batch.
 *
 * @param {any} turso
 * @param {import("./index").TouchedKeys} touched
 * @returns {Promise<Record<string, { rows: Record<string, unknown>[], deleteKeys: unknown[][] }>>}
 */
export async function recomputeTouchedRollups(turso, touched) {
  const tools = Array.from(new Set(touched.toolKeys.map((item) => item[1])))
  return {
    session_rollups: await recomputeSessionRollups(turso, touched.sessionIDs),
    session_model_rollups: await recomputeSessionModelRollups(turso, touched.sessionIDs),
    project_rollups: await recomputeProjectRollups(turso, touched.projectIDs),
    project_model_rollups: await recomputeProjectModelRollups(turso, touched.projectIDs),
    tool_rollups: await recomputeToolRollups(turso, tools),
    daily_global_rollups: await recomputeDailyGlobalRollups(turso, touched.days),
    daily_model_rollups: await recomputeDailyModelRollups(turso, touched.modelKeys),
    daily_tool_rollups: await recomputeDailyToolRollups(turso, touched.toolKeys),
    daily_project_rollups: await recomputeDailyProjectRollups(turso, touched.projectDayKeys),
  }
}
