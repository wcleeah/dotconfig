import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { Database } from "bun:sqlite"
import { describe, expect, it } from "bun:test"

import { createOpenCodeHydrator } from "../history.js"
import { createTrackerState, normalizeEvent } from "../normalize.js"

function createFixtureDb() {
  const root = mkdtempSync(join(tmpdir(), "usage-tracker-history-"))
  const dbPath = join(root, "opencode.db")
  const db = new Database(dbPath)

  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      parent_id TEXT,
      time_created INTEGER NOT NULL
    );

    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      data TEXT NOT NULL
    );

    CREATE TABLE part (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      data TEXT NOT NULL
    );
  `)

  db.query("INSERT INTO session (id, project_id, parent_id, time_created) VALUES (?, ?, ?, ?)").run(
    "ses_root",
    "proj_1",
    null,
    Date.UTC(2026, 0, 1, 10, 0),
  )

  db.query("INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)").run(
    "msg_user",
    "ses_root",
    Date.UTC(2026, 0, 1, 10, 0),
    JSON.stringify({
      role: "user",
      time: { created: Date.UTC(2026, 0, 1, 10, 0) },
    }),
  )

  db.query("INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)").run(
    "part_user_text",
    "msg_user",
    "ses_root",
    Date.UTC(2026, 0, 1, 10, 0, 10),
    JSON.stringify({
      type: "text",
      messageID: "msg_user",
      sessionID: "ses_root",
      text: "hello world",
      time: { start: Date.UTC(2026, 0, 1, 10, 0, 10), updated: Date.UTC(2026, 0, 1, 10, 0, 10) },
    }),
  )

  db.query("INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)").run(
    "msg_assistant",
    "ses_root",
    Date.UTC(2026, 0, 1, 10, 1),
    JSON.stringify({
      role: "assistant",
      parentID: "msg_user",
      providerID: "github-copilot",
      modelID: "gpt-5.4",
      time: {
        created: Date.UTC(2026, 0, 1, 10, 1),
        completed: Date.UTC(2026, 0, 1, 10, 2),
      },
    }),
  )

  db.query("INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)").run(
    "step_start",
    "msg_assistant",
    "ses_root",
    Date.UTC(2026, 0, 1, 10, 1, 5),
    JSON.stringify({
      type: "step-start",
      messageID: "msg_assistant",
      sessionID: "ses_root",
      time: { start: Date.UTC(2026, 0, 1, 10, 1, 5) },
    }),
  )

  db.query("INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)").run(
    "tool_1",
    "msg_assistant",
    "ses_root",
    Date.UTC(2026, 0, 1, 10, 1, 6),
    JSON.stringify({
      type: "tool",
      messageID: "msg_assistant",
      sessionID: "ses_root",
      callID: "call_1",
      tool: "read",
      state: {
        status: "completed",
        input: { filePath: "/tmp/file.ts" },
        output: "ok",
        time: {
          start: Date.UTC(2026, 0, 1, 10, 1, 6),
          end: Date.UTC(2026, 0, 1, 10, 1, 7),
        },
      },
    }),
  )

  db.close()

  return { root, dbPath }
}

describe("history hydrator", () => {
  it("backfills a historical user turn before a new assistant reply updates duration", async () => {
    const fixture = createFixtureDb()

    try {
      const state = createTrackerState({ id: "proj_1" })
      const hydrator = createOpenCodeHydrator({ state, dbPath: fixture.dbPath })
      await hydrator.hydrateSessions()

      const event = {
        type: "message.updated",
        properties: {
          info: {
            id: "msg_assistant_live",
            role: "assistant",
            parentID: "msg_user",
            sessionID: "ses_root",
            providerID: "github-copilot",
            modelID: "gpt-5.4",
            time: {
              created: Date.UTC(2026, 0, 1, 10, 3),
              completed: Date.UTC(2026, 0, 1, 10, 4),
            },
          },
        },
      }

      await hydrator.hydrateEventContext(event)
      const normalized = normalizeEvent(event, state)

      expect(normalized.facts.turns).toHaveLength(1)
      expect(normalized.facts.turns[0]).toMatchObject({
        id: "msg_user",
        content: "hello world",
        turn_duration_ms: 240000,
      })
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it("backfills old tool-day state before a historical tool call shifts days", async () => {
    const fixture = createFixtureDb()

    try {
      const state = createTrackerState({ id: "proj_1" })
      const hydrator = createOpenCodeHydrator({ state, dbPath: fixture.dbPath })
      await hydrator.hydrateSessions()

      const event = {
        type: "message.part.updated",
        properties: {
          part: {
            id: "tool_1",
            type: "tool",
            messageID: "msg_assistant",
            sessionID: "ses_root",
            callID: "call_1",
            tool: "read",
            state: {
              status: "completed",
              input: { filePath: "/tmp/file.ts" },
              output: "ok",
              time: {
                start: Date.UTC(2026, 0, 2, 9),
                end: Date.UTC(2026, 0, 2, 9, 1),
              },
            },
          },
        },
      }

      await hydrator.hydrateEventContext(event)
      const normalized = normalizeEvent(event, state)

      expect(normalized.facts.tool_calls[0]).toMatchObject({
        id: "tool_1",
        step_id: "step_start",
      })
      expect(normalized.touched.toolKeys).toEqual([
        ["2026-01-02", "read"],
        ["2026-01-01", "read"],
      ])
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })
})
