import { describe, expect, it } from "bun:test"

import { createOpenCodeHydrator } from "../history.js"
import { createTrackerState, normalizeEvent } from "../normalize.js"
import { copyFixtureDb } from "./fixture-db.js"

describe("history hydrator", () => {
  it("backfills a historical user turn before a new assistant reply updates duration", async () => {
    const fixture = copyFixtureDb("simple-turn.sqlite")

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
      fixture.cleanup()
    }
  })

  it("backfills old tool-day state before a historical tool call shifts days", async () => {
    const fixture = copyFixtureDb("historical-tool-day.sqlite")

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
      fixture.cleanup()
    }
  })
})
