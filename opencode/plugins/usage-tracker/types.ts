export interface PendingToolCall {
  readonly startedAt: number
  readonly sessionID: string
  readonly messageID?: string
  readonly toolName: string
  readonly args?: unknown
  readonly turnID?: string
}

export interface ActiveTurn {
  readonly turnID: string
  readonly sessionID: string
  readonly parentTurnID?: string
  readonly startedAt: number
}

export interface PluginState {
  readonly pendingToolCalls: ReadonlyMap<string, PendingToolCall>
  readonly sessionParentIDs: ReadonlyMap<string, string | null>
  readonly activeTurns: ReadonlyMap<string, ActiveTurn>
  readonly sessionToParentTurn: ReadonlyMap<string, string>
  readonly compactingSessions: ReadonlyMap<string, number> // sessionID -> compaction row ID
}
