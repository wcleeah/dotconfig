import { describe, expect, it } from 'bun:test'

import { CREATE_STATEMENTS, INDEX_STATEMENTS, TABLES, makeUpsertStatement, rowArgs } from '../schema.js'

describe('schema', () => {
  it('generates create statements from table metadata', () => {
    expect(CREATE_STATEMENTS.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS projects'))).toBe(true)
    expect(CREATE_STATEMENTS.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS daily_project_rollups'))).toBe(true)
    expect(CREATE_STATEMENTS.some((sql) => sql.includes('PRIMARY KEY (tool_call_id, payload_type)'))).toBe(true)
  })

  it('generates index statements from table metadata', () => {
    expect(INDEX_STATEMENTS).toContain('CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id ASC, time_updated DESC)')
    expect(INDEX_STATEMENTS).toContain('CREATE INDEX IF NOT EXISTS idx_tool_calls_tool ON tool_calls(tool, started_at)')
  })

  it('builds upsert SQL that updates non-primary-key columns', () => {
    const sql = makeUpsertStatement(TABLES.responses)

    expect(sql).toContain('INSERT INTO responses')
    expect(sql).toContain('ON CONFLICT(id) DO UPDATE SET')
    expect(sql).toContain('error_message = excluded.error_message')
    expect(sql).not.toContain('id = excluded.id')
  })

  it('serializes row arguments in declared column order', () => {
    const args = rowArgs(TABLES.toolCalls, {
      id: 'tool_1',
      response_id: 'msg_assistant',
      session_id: 'ses_root',
      root_session_id: 'ses_root',
      project_id: 'proj_1',
      step_id: 'step_1',
      call_id: 'call_1',
      tool: 'read',
      status: 'completed',
      title: 'Read file',
      error: null,
      input_bytes: 10,
      output_bytes: 20,
      compacted_at: null,
      started_at: 1000,
      completed_at: 1100,
      duration_ms: 100,
      time_updated: 1100,
    })

    expect(args).toEqual([
      'tool_1',
      'msg_assistant',
      'ses_root',
      'ses_root',
      'proj_1',
      'step_1',
      'call_1',
      'read',
      'completed',
      'Read file',
      null,
      10,
      20,
      null,
      1000,
      1100,
      100,
      1100,
    ])
  })
})
