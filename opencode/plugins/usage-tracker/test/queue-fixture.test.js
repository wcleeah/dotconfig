import { describe, expect, it } from "bun:test"
import { Database } from "bun:sqlite"

import { createTrackerState, normalizeEvent, rememberSessionProject } from "../normalize.js"
import { copyFixtureDb } from "./fixture-db.js"

function loadFixtureRows(name) {
  const fixture = copyFixtureDb(name)
  const db = new Database(fixture.dbPath, { readonly: true })

  try {
    return {
      sessions: db.query("SELECT id, project_id, parent_id, time_created FROM session ORDER BY time_created, id").all(),
      messages: db.query("SELECT id, session_id, time_created, data FROM message ORDER BY time_created, id").all(),
      parts: db.query("SELECT id, message_id, session_id, time_created, data FROM part ORDER BY time_created, id").all(),
    }
  } finally {
    db.close()
    fixture.cleanup()
  }
}

function toSessionEvent(row) {
  return {
    type: "session.created",
    properties: {
      info: {
        id: String(row.id),
        projectID: String(row.project_id),
        parentID: row.parent_id ? String(row.parent_id) : null,
        slug: String(row.id),
        directory: "/tmp/project",
        title: String(row.id),
        version: "1.0.0",
        time: {
          created: Number(row.time_created),
          updated: Number(row.time_created),
        },
      },
    },
  }
}

function toMessageEvent(row) {
  const data = JSON.parse(String(row.data))

  return {
    type: "message.updated",
    properties: {
      info: {
        ...data,
        id: String(row.id),
        sessionID: String(row.session_id),
        time: data.time ?? { created: Number(row.time_created) },
      },
    },
  }
}

function toPartEvent(row) {
  const data = JSON.parse(String(row.data))

  return {
    type: "message.part.updated",
    properties: {
      part: {
        ...data,
        id: String(row.id),
        messageID: String(row.message_id),
        sessionID: String(row.session_id),
      },
    },
  }
}

function createFixtureState() {
  return createTrackerState({ id: "proj_1" })
}

function seedSessions(state, sessions) {
  for (const row of sessions) {
    rememberSessionProject(state, {
      id: String(row.id),
      projectID: String(row.project_id),
      parentID: row.parent_id ? String(row.parent_id) : null,
    })
  }
}

describe("fixture-driven tracker flows", () => {
  it("simple turn fixture preserves turn duration semantics from committed SQLite input", () => {
    const state = createFixtureState()
    const { sessions, messages } = loadFixtureRows("simple-turn.sqlite")

    seedSessions(state, sessions)

    const messageFacts = messages.map((row) => normalizeEvent(toMessageEvent(row), state))
    const turnRows = messageFacts.flatMap((entry) => entry.facts.turns)
    const responseRows = messageFacts.flatMap((entry) => entry.facts.responses)

    expect(responseRows).toHaveLength(1)
    expect(turnRows.some((row) => row.id === "msg_user" && row.turn_duration_ms === 120000)).toBe(true)
  })

  it("tool-heavy fixture preserves day, model, and tool touched keys from committed SQLite input", () => {
    const state = createFixtureState()
    const { sessions, messages, parts } = loadFixtureRows("tool-heavy.sqlite")

    seedSessions(state, sessions)

    const messageFacts = messages.map((row) => normalizeEvent(toMessageEvent(row), state))
    const partFacts = parts.map((row) => normalizeEvent(toPartEvent(row), state))

    const responseRows = messageFacts.flatMap((entry) => entry.facts.responses)
    const toolCalls = partFacts.flatMap((entry) => entry.facts.tool_calls)
    const toolPayloads = partFacts.flatMap((entry) => entry.facts.tool_payloads)
    const touchedDays = new Set(partFacts.flatMap((entry) => entry.touched.days))
    const touchedTools = partFacts.flatMap((entry) => entry.touched.toolKeys)
    const touchedModels = messageFacts.flatMap((entry) => entry.touched.modelKeys)

    expect(responseRows[0]).toMatchObject({
      id: "msg_assistant",
      finish: "tool-calls",
      model_id: "gpt-5.4",
    })
    expect(toolCalls.map((row) => [row.id, row.step_id, row.tool])).toEqual([
      ["tool_read", "step_start", "read"],
      ["tool_grep", "step_start", "grep"],
    ])
    expect(toolPayloads).toHaveLength(4)
    expect(Array.from(touchedDays)).toEqual(["2026-01-01"])
    expect(touchedTools).toEqual([
      ["2026-01-01", "read"],
      ["2026-01-01", "grep"],
    ])
    expect(touchedModels).toEqual([["2026-01-01", "gpt-5.4", "github-copilot"]])
  })

  it("lineage fixture preserves ancestor session invalidation semantics", () => {
    const state = createFixtureState()
    const { sessions, messages } = loadFixtureRows("lineage.sqlite")

    const sessionFacts = sessions.map((row) => normalizeEvent(toSessionEvent(row), state))
    const messageFacts = messages.map((row) => normalizeEvent(toMessageEvent(row), state))

    const childTouched = messageFacts[0]?.touched.sessionIDs ?? []
    const grandchildTouched = messageFacts[1]?.touched.sessionIDs ?? []
    const sessionRoots = sessionFacts.flatMap((entry) => entry.facts.sessions.map((row) => [row.id, row.root_session_id]))

    expect(sessionRoots).toEqual([
      ["ses_root", "ses_root"],
      ["ses_child", "ses_root"],
      ["ses_grandchild", "ses_root"],
    ])
    expect(childTouched).toEqual(["ses_child", "ses_root"])
    expect(grandchildTouched).toEqual(["ses_grandchild", "ses_child", "ses_root"])
  })

  it("historical hydration fixture remains compatible with the fixture-driven history path", () => {
    const { sessions, messages, parts } = loadFixtureRows("historical-tool-day.sqlite")

    expect(sessions).toHaveLength(1)
    expect(messages.map((row) => row.id)).toEqual(["msg_user", "msg_assistant"])
    expect(parts.map((row) => row.id)).toEqual(["part_user_text", "step_start", "tool_1"])
  })
})
