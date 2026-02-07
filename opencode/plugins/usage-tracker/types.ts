export interface ActiveTurn {
  readonly turnID: string
  readonly sessionID: string
  readonly parentTurnID?: string
  readonly startedAt: number
}

export interface PluginState {
  readonly sessionParentIDs: ReadonlyMap<string, string | null>
  readonly activeTurns: ReadonlyMap<string, ActiveTurn>
  readonly sessionToParentTurn: ReadonlyMap<string, string>
}
