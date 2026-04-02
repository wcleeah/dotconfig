import { describe, expect, it } from 'bun:test'

import { createTrackerState, mergeTurnRows, normalizeEvent } from '../normalize.js'

describe('normalizeEvent', () => {
  it('tracks user turns, assistant responses, and step/tool parts', () => {
    const state = createTrackerState({ id: 'proj_1' })

    normalizeEvent(
      {
        type: 'session.created',
        properties: {
          info: {
            id: 'ses_root',
            projectID: 'proj_1',
            slug: 'root',
            directory: '/tmp/project',
            title: 'Root session',
            version: '1.0.0',
            time: { created: 1000, updated: 1000 },
          },
        },
      },
      state,
    )

    const userUpdate = normalizeEvent(
      {
        type: 'message.updated',
        properties: {
          info: {
            id: 'msg_user',
            role: 'user',
            sessionID: 'ses_root',
            time: { created: 2000 },
          },
        },
      },
      state,
    )

    expect(userUpdate.facts.turns).toHaveLength(1)
    expect(userUpdate.facts.turns[0]).toMatchObject({
      id: 'msg_user',
      session_id: 'ses_root',
      project_id: 'proj_1',
    })

    const assistantUpdate = normalizeEvent(
      {
        type: 'message.updated',
        properties: {
          info: {
            id: 'msg_assistant',
            role: 'assistant',
            parentID: 'msg_user',
            sessionID: 'ses_root',
            providerID: 'github-copilot',
            modelID: 'gpt-5.4',
            agent: 'code',
            finish: 'end-turn',
            cost: 0,
            tokens: {
              input: 50,
              output: 25,
              reasoning: 5,
              cache: { read: 10, write: 2 },
            },
            time: { created: 2500, completed: 3000 },
          },
        },
      },
      state,
    )

    expect(assistantUpdate.facts.responses).toHaveLength(1)
    expect(assistantUpdate.facts.turns.some((turn) => turn.turn_duration_ms === 1000)).toBe(true)

    const stepUpdate = normalizeEvent(
      {
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'step_1',
            type: 'step-finish',
            messageID: 'msg_assistant',
            sessionID: 'ses_root',
            reason: 'end-turn',
            cost: 0.01,
            tokens: {
              input: 50,
              output: 25,
              reasoning: 5,
              cache: { read: 10, write: 2 },
            },
          },
        },
      },
      state,
    )

    expect(stepUpdate.facts.llm_steps).toHaveLength(1)
    expect(stepUpdate.facts.llm_steps[0].model_id).toBe('gpt-5.4')

    const toolUpdate = normalizeEvent(
      {
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'tool_1',
            type: 'tool',
            messageID: 'msg_assistant',
            sessionID: 'ses_root',
            callID: 'call_1',
            tool: 'read',
            state: {
              status: 'completed',
              input: { filePath: '/tmp/file.ts' },
              output: 'ok',
              title: 'Reads file',
              time: { start: 2600, end: 2700 },
            },
          },
        },
      },
      state,
    )

    expect(toolUpdate.facts.tool_calls).toHaveLength(1)
    expect(toolUpdate.facts.tool_payloads).toHaveLength(2)
    expect(toolUpdate.touched.toolKeys).toEqual([[new Date(2600).toISOString().slice(0, 10), 'read']])
  })

  it('does not finalize turn duration when assistant finish is unknown', () => {
    const state = createTrackerState({ id: 'proj_1' })

    normalizeEvent(
      {
        type: 'session.created',
        properties: {
          info: {
            id: 'ses_root',
            projectID: 'proj_1',
            slug: 'root',
            directory: '/tmp/project',
            title: 'Root session',
            version: '1.0.0',
            time: { created: 1000, updated: 1000 },
          },
        },
      },
      state,
    )

    normalizeEvent(
      {
        type: 'message.updated',
        properties: {
          info: {
            id: 'msg_user',
            role: 'user',
            sessionID: 'ses_root',
            time: { created: 2000 },
          },
        },
      },
      state,
    )

    const assistantUpdate = normalizeEvent(
      {
        type: 'message.updated',
        properties: {
          info: {
            id: 'msg_assistant',
            role: 'assistant',
            parentID: 'msg_user',
            sessionID: 'ses_root',
            providerID: 'github-copilot',
            modelID: 'gpt-5.4',
            agent: 'plan',
            finish: 'unknown',
            cost: 0,
            tokens: {
              input: 50,
              output: 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
            time: { created: 2500, completed: 3000 },
          },
        },
      },
      state,
    )

    expect(assistantUpdate.facts.responses).toHaveLength(1)
    expect(assistantUpdate.facts.turns).toHaveLength(0)
  })

  it('keeps turn content when duration is added later', () => {
    const merged = mergeTurnRows(
      {
        id: 'msg_user',
        session_id: 'ses_root',
        root_session_id: 'ses_root',
        project_id: 'proj_1',
        content: 'hello world',
        synthetic: 0,
        compaction: 0,
        undone_at: null,
        time_created: 2000,
        time_updated: 2100,
        turn_duration_ms: null,
      },
      {
        id: 'msg_user',
        session_id: 'ses_root',
        root_session_id: 'ses_root',
        project_id: 'proj_1',
        content: null,
        synthetic: 0,
        compaction: 0,
        undone_at: null,
        time_created: 2000,
        time_updated: 3000,
        turn_duration_ms: 1000,
      },
    )

    expect(merged.content).toBe('hello world')
    expect(merged.turn_duration_ms).toBe(1000)
    expect(merged.time_updated).toBe(3000)
  })

  it('preserves user turn content across separate event batches', () => {
    const state = createTrackerState({ id: 'proj_1' })

    normalizeEvent(
      {
        type: 'session.created',
        properties: {
          info: {
            id: 'ses_root',
            projectID: 'proj_1',
            slug: 'root',
            directory: '/tmp/project',
            title: 'Root session',
            version: '1.0.0',
            time: { created: 1000, updated: 1000 },
          },
        },
      },
      state,
    )

    normalizeEvent(
      {
        type: 'message.updated',
        properties: {
          info: {
            id: 'msg_user',
            role: 'user',
            sessionID: 'ses_root',
            time: { created: 2000 },
          },
        },
      },
      state,
    )

    normalizeEvent(
      {
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'part_user_text',
            type: 'text',
            messageID: 'msg_user',
            sessionID: 'ses_root',
            text: 'hello world',
            time: { start: 2010, updated: 2010 },
          },
        },
      },
      state,
    )

    const assistantUpdate = normalizeEvent(
      {
        type: 'message.updated',
        properties: {
          info: {
            id: 'msg_assistant',
            role: 'assistant',
            parentID: 'msg_user',
            sessionID: 'ses_root',
            providerID: 'github-copilot',
            modelID: 'gpt-5.4',
            finish: 'end-turn',
            time: { created: 2500, completed: 3000 },
          },
        },
      },
      state,
    )

    expect(assistantUpdate.facts.turns[0]).toMatchObject({
      id: 'msg_user',
      content: 'hello world',
      turn_duration_ms: 1000,
    })
  })

  it('does not let synthetic user attachment text overwrite the real user prompt', () => {
    const state = createTrackerState({ id: 'proj_1' })

    normalizeEvent(
      {
        type: 'session.created',
        properties: {
          info: {
            id: 'ses_root',
            projectID: 'proj_1',
            slug: 'root',
            directory: '/tmp/project',
            title: 'Root session',
            version: '1.0.0',
            time: { created: 1000, updated: 1000 },
          },
        },
      },
      state,
    )

    normalizeEvent(
      {
        type: 'message.updated',
        properties: {
          info: {
            id: 'msg_user',
            role: 'user',
            sessionID: 'ses_root',
            time: { created: 2000 },
          },
        },
      },
      state,
    )

    normalizeEvent(
      {
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'part_user_text',
            type: 'text',
            messageID: 'msg_user',
            sessionID: 'ses_root',
            text: 'trace every path',
            time: { start: 2010, updated: 2010 },
          },
        },
      },
      state,
    )

    const syntheticAttachment = normalizeEvent(
      {
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'part_attachment_text',
            type: 'text',
            messageID: 'msg_user',
            sessionID: 'ses_root',
            text: '<path>/tmp/file</path>\n<content>expanded file</content>',
            synthetic: true,
            time: { start: 2020, updated: 2020 },
          },
        },
      },
      state,
    )

    expect(syntheticAttachment.facts.turns[0]).toMatchObject({
      id: 'msg_user',
      content: 'trace every path',
      synthetic: 0,
    })
  })

  it('uses the step-start id as the canonical step id', () => {
    const state = createTrackerState({ id: 'proj_1' })

    normalizeEvent(
      {
        type: 'session.created',
        properties: {
          info: {
            id: 'ses_root',
            projectID: 'proj_1',
            slug: 'root',
            directory: '/tmp/project',
            title: 'Root session',
            version: '1.0.0',
            time: { created: 1000, updated: 1000 },
          },
        },
      },
      state,
    )

    normalizeEvent(
      {
        type: 'message.updated',
        properties: {
          info: {
            id: 'msg_user',
            role: 'user',
            sessionID: 'ses_root',
            time: { created: 2000 },
          },
        },
      },
      state,
    )

    normalizeEvent(
      {
        type: 'message.updated',
        properties: {
          info: {
            id: 'msg_assistant',
            role: 'assistant',
            parentID: 'msg_user',
            sessionID: 'ses_root',
            providerID: 'github-copilot',
            modelID: 'gpt-5.4',
            time: { created: 2500, completed: 3000 },
          },
        },
      },
      state,
    )

    normalizeEvent(
      {
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'step_start',
            type: 'step-start',
            messageID: 'msg_assistant',
            sessionID: 'ses_root',
          },
        },
      },
      state,
    )

    const stepFinish = normalizeEvent(
      {
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'step_finish',
            type: 'step-finish',
            messageID: 'msg_assistant',
            sessionID: 'ses_root',
            reason: 'end-turn',
            cost: 0.01,
            tokens: {
              input: 50,
              output: 25,
              reasoning: 5,
              cache: { read: 10, write: 2 },
            },
          },
        },
      },
      state,
    )

    const toolUpdate = normalizeEvent(
      {
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'tool_1',
            type: 'tool',
            messageID: 'msg_assistant',
            sessionID: 'ses_root',
            callID: 'call_1',
            tool: 'read',
            state: {
              status: 'completed',
              input: { filePath: '/tmp/file.ts' },
              output: 'ok',
              time: { start: 2600, end: 2700 },
            },
          },
        },
      },
      state,
    )

    expect(stepFinish.facts.llm_steps[0]?.id).toBe('step_start')
    expect(toolUpdate.facts.tool_calls[0]?.step_id).toBe('step_start')
  })

  it('marks both old and removal days touched when a turn is removed later', () => {
    const state = createTrackerState({ id: 'proj_1' })

    normalizeEvent(
      {
        type: 'session.created',
        properties: {
          info: {
            id: 'ses_root',
            projectID: 'proj_1',
            slug: 'root',
            directory: '/tmp/project',
            title: 'Root session',
            version: '1.0.0',
            time: { created: 1000, updated: 1000 },
          },
        },
      },
      state,
    )

    normalizeEvent(
      {
        type: 'message.updated',
        properties: {
          info: {
            id: 'msg_user',
            role: 'user',
            sessionID: 'ses_root',
            time: { created: Date.UTC(2026, 0, 1) },
          },
        },
      },
      state,
    )

    const removed = normalizeEvent(
      {
        type: 'message.removed',
        properties: {
          sessionID: 'ses_root',
          messageID: 'msg_user',
          time: { removed: Date.UTC(2026, 0, 3) },
        },
      },
      state,
    )

    expect(removed.touched.days).toEqual(['2026-01-03', '2026-01-01'])
    expect(removed.touched.projectDayKeys).toEqual([
      ['2026-01-03', 'proj_1'],
      ['2026-01-01', 'proj_1'],
    ])
  })

  it('touches both old and new tool day buckets when a tool call shifts days', () => {
    const state = createTrackerState({ id: 'proj_1' })

    normalizeEvent(
      {
        type: 'session.created',
        properties: {
          info: {
            id: 'ses_root',
            projectID: 'proj_1',
            slug: 'root',
            directory: '/tmp/project',
            title: 'Root session',
            version: '1.0.0',
            time: { created: 1000, updated: 1000 },
          },
        },
      },
      state,
    )

    normalizeEvent(
      {
        type: 'message.updated',
        properties: {
          info: {
            id: 'msg_user',
            role: 'user',
            sessionID: 'ses_root',
            time: { created: Date.UTC(2026, 0, 1, 10) },
          },
        },
      },
      state,
    )

    normalizeEvent(
      {
        type: 'message.updated',
        properties: {
          info: {
            id: 'msg_assistant',
            role: 'assistant',
            parentID: 'msg_user',
            sessionID: 'ses_root',
            providerID: 'github-copilot',
            modelID: 'gpt-5.4',
            finish: 'tool-calls',
            time: { created: Date.UTC(2026, 0, 1, 10, 1), completed: Date.UTC(2026, 0, 1, 10, 2) },
          },
        },
      },
      state,
    )

    normalizeEvent(
      {
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'tool_1',
            type: 'tool',
            messageID: 'msg_assistant',
            sessionID: 'ses_root',
            callID: 'call_1',
            tool: 'read',
            state: {
              status: 'completed',
              time: { start: Date.UTC(2026, 0, 1, 10, 3), end: Date.UTC(2026, 0, 1, 10, 4) },
            },
          },
        },
      },
      state,
    )

    const updated = normalizeEvent(
      {
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'tool_1',
            type: 'tool',
            messageID: 'msg_assistant',
            sessionID: 'ses_root',
            callID: 'call_1',
            tool: 'read',
            state: {
              status: 'completed',
              time: { start: Date.UTC(2026, 0, 2, 9), end: Date.UTC(2026, 0, 2, 9, 1) },
            },
          },
        },
      },
      state,
    )

    expect(updated.touched.toolKeys).toEqual([
      ['2026-01-02', 'read'],
      ['2026-01-01', 'read'],
    ])
    expect(updated.touched.projectDayKeys).toEqual([
      ['2026-01-02', 'proj_1'],
      ['2026-01-01', 'proj_1'],
    ])
  })

  it('captures compaction turns separately from user turns', () => {
    const state = createTrackerState({ id: 'proj_1' })

    normalizeEvent(
      {
        type: 'session.created',
        properties: {
          info: {
            id: 'ses_root',
            projectID: 'proj_1',
            slug: 'root',
            directory: '/tmp/project',
            title: 'Root session',
            version: '1.0.0',
            time: { created: 1000, updated: 1000 },
          },
        },
      },
      state,
    )

    normalizeEvent(
      {
        type: 'message.updated',
        properties: {
          info: {
            id: 'msg_assistant',
            role: 'assistant',
            parentID: 'msg_user',
            sessionID: 'ses_root',
            providerID: 'github-copilot',
            modelID: 'gpt-5.4',
            time: { created: 2000, completed: 2600 },
          },
        },
      },
      state,
    )

    const compaction = normalizeEvent(
      {
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'part_compaction',
            type: 'compaction',
            messageID: 'msg_assistant',
            sessionID: 'ses_root',
            time: { start: 2100, updated: 2200 },
          },
        },
      },
      state,
    )

    expect(compaction.facts.turns[0]).toMatchObject({
      id: 'msg_assistant',
      synthetic: 1,
      compaction: 1,
    })
  })
})
