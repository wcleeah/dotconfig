import type { PluginState } from "./types"

export const createPluginState = (): PluginState => ({
  sessionParentIDs: new Map(),
  activeTurns: new Map(),
  sessionToParentTurn: new Map(),
})

export const getCurrentTurnID = (state: PluginState, sessionID: string): string | null =>
  state.activeTurns.get(sessionID)?.turnID ??
  state.sessionToParentTurn.get(sessionID) ??
  null
