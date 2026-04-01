export type Primitive = string | number | boolean | null

export interface ColumnSpec {
  name: string
  type: string
  notNull?: boolean
  defaultValue?: string | number
  primaryKey?: boolean
}

export interface IndexSpec {
  name: string
  columns: string[]
  orders?: string[]
  unique?: boolean
}

export interface TableSpec {
  name: string
  columns: ColumnSpec[]
  primaryKey: string[]
  indexes: IndexSpec[]
}

export interface TouchedKeys {
  projectIDs: string[]
  sessionIDs: string[]
  rootSessionIDs: string[]
  days: string[]
   projectDayKeys: [string, string][]
  modelKeys: [string, string, string][]
  toolKeys: [string, string][]
}

export interface FactsPayload {
  projects: Array<Record<string, unknown>>
  sessions: Array<Record<string, unknown>>
  turns: Array<Record<string, unknown>>
  responses: Array<Record<string, unknown>>
  response_parts: Array<Record<string, unknown>>
  llm_steps: Array<Record<string, unknown>>
  tool_calls: Array<Record<string, unknown>>
  tool_payloads: Array<Record<string, unknown>>
}

export interface NormalizedEventPayload {
  facts: FactsPayload
  touched: TouchedKeys
}

export interface TrackerState {
  projectID: string | null
  rootSessionMap: Map<string, string>
  parentSessionMap: Map<string, string | null>
  sessionProjectMap: Map<string, string>
  messageStepMap: Map<string, string>
  responseMap: Map<string, Record<string, unknown>>
  turnRowMap: Map<string, Record<string, unknown>>
  turnCreatedMap: Map<string, number>
   toolDayMap: Map<string, string>
}

export interface QueueBatch {
  batchID: string
  createdAt: number
  retryCount?: number
  facts: FactsPayload
  touched: TouchedKeys
}

export interface RollupReplacePayload {
  rows: Array<Record<string, unknown>>
  deleteKeys: Array<Array<string | number | null>>
}

export interface OutboxHandle {
  root: string
  processDir: string
  persist(batch: QueueBatch): string
  remove(batchID: string): void
  list(): string[]
  read(file: string): QueueBatch
  listAllOrphans(): string[]
}
