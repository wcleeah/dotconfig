import type { Database } from "bun:sqlite"
import type { Session } from "@opencode-ai/sdk"
import type { PluginState } from "../types"
import { logError } from "../utils"

export const onSessionCreated = (
  db: Database,
  state: PluginState,
  session: Session,
  projectPath: string,
  worktree: string
): PluginState => {
  try {
    db.prepare(`
      INSERT OR REPLACE INTO sessions (id, title, parent_id, project_path, worktree, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      session.id,
      session.title ?? null,
      session.parentID ?? null,
      projectPath,
      worktree,
      session.time.created,
      session.time.updated
    )

    const newSessionParentIDs = new Map(state.sessionParentIDs).set(session.id, session.parentID ?? null)

    // If subagent, link to parent's active turn
    if (session.parentID) {
      const parentTurn = state.activeTurns.get(session.parentID)
      if (parentTurn) {
        return {
          ...state,
          sessionParentIDs: newSessionParentIDs,
          sessionToParentTurn: new Map(state.sessionToParentTurn).set(session.id, parentTurn.turnID),
        }
      }
    }

    return { ...state, sessionParentIDs: newSessionParentIDs }
  } catch (err) {
    logError(db, "session.created", { session, projectPath, worktree }, err)
    return state
  }
}

export const onSessionUpdated = (
  db: Database,
  state: PluginState,
  session: Session
): PluginState => {
  try {
    db.prepare(`
      UPDATE sessions SET title = ?, parent_id = ?, updated_at = ? WHERE id = ?
    `).run(session.title ?? null, session.parentID ?? null, session.time.updated, session.id)

    return {
      ...state,
      sessionParentIDs: new Map(state.sessionParentIDs).set(session.id, session.parentID ?? null),
    }
  } catch (err) {
    logError(db, "session.updated", session, err)
    return state
  }
}

export const onSessionIdle = (
  db: Database,
  state: PluginState,
  sessionID: string
): PluginState => {
  try {
    const activeTurn = state.activeTurns.get(sessionID)

    const transaction = db.transaction(() => {
      db.prepare(`
        UPDATE sessions SET ended_at = ?, updated_at = ? WHERE id = ?
      `).run(Date.now(), Date.now(), sessionID)

      if (activeTurn) {
        db.prepare(`UPDATE turns SET ended_at = ? WHERE id = ?`).run(Date.now(), activeTurn.turnID)
      }
    })

    transaction()

    if (activeTurn) {
      const newActiveTurns = new Map(state.activeTurns)
      newActiveTurns.delete(sessionID)
      return { ...state, activeTurns: newActiveTurns }
    }

    return state
  } catch (err) {
    logError(db, "session.idle", { sessionID }, err)
    return state
  }
}

export const onSessionDeleted = (
  db: Database,
  state: PluginState,
  session: Session
): PluginState => {
  try {
    db.prepare(`
      UPDATE sessions SET updated_at = ? WHERE id = ?
    `).run(Date.now(), session.id)

    const newSessionParentIDs = new Map(state.sessionParentIDs)
    newSessionParentIDs.delete(session.id)

    const newActiveTurns = new Map(state.activeTurns)
    newActiveTurns.delete(session.id)

    const newSessionToParentTurn = new Map(state.sessionToParentTurn)
    newSessionToParentTurn.delete(session.id)

    const newCompactingSessions = new Map(state.compactingSessions)
    newCompactingSessions.delete(session.id)

    return {
      ...state,
      sessionParentIDs: newSessionParentIDs,
      activeTurns: newActiveTurns,
      sessionToParentTurn: newSessionToParentTurn,
      compactingSessions: newCompactingSessions,
    }
  } catch (err) {
    logError(db, "session.deleted", session, err)
    return state
  }
}

export const onSessionCompacting = (
  db: Database,
  state: PluginState,
  sessionID: string
): PluginState => {
  try {
    const result = db.prepare(`
      INSERT INTO compactions (session_id, started_at)
      VALUES (?, ?)
    `).run(sessionID, Date.now())

    const compactionRowID = result.lastInsertRowid as number

    return {
      ...state,
      compactingSessions: new Map(state.compactingSessions).set(sessionID, compactionRowID),
    }
  } catch (err) {
    logError(db, "session.compacting", { sessionID }, err)
    return state
  }
}

export const onSessionCompacted = (
  db: Database,
  state: PluginState,
  sessionID: string
): PluginState => {
  try {
    const compactionRowID = state.compactingSessions.get(sessionID)
    if (compactionRowID) {
      db.prepare(`
        UPDATE compactions SET completed_at = ? WHERE id = ?
      `).run(Date.now(), compactionRowID)
    }

    const newCompactingSessions = new Map(state.compactingSessions)
    newCompactingSessions.delete(sessionID)

    return {
      ...state,
      compactingSessions: newCompactingSessions,
    }
  } catch (err) {
    logError(db, "session.compacted", { sessionID }, err)
    return state
  }
}
