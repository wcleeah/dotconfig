import { byteLength, coalesce, textValue } from "./utils.js"

/**
 * @typedef {import("./index").NormalizedEventPayload} NormalizedEventPayload
 * @typedef {import("./index").TrackerState} TrackerState
 */

/**
 * Normalizes OpenCode session summary metadata.
 *
 * @param {Record<string, unknown> | undefined} summary
 * @returns {{ additions: number, deletions: number, files: number }}
 */
function sessionSummary(summary) {
  return {
    additions: summary?.additions ?? 0,
    deletions: summary?.deletions ?? 0,
    files: summary?.files ?? 0,
  }
}

/**
 * Merges partial turn rows that arrive across multiple events.
 *
 * @param {Record<string, unknown> | undefined} existing
 * @param {Record<string, unknown>} next
 * @returns {Record<string, unknown>}
 */
export function mergeTurnRows(existing, next) {
  if (!existing) return next
  return {
    ...existing,
    ...next,
    content: next.content ?? existing.content,
    synthetic: Math.max(existing.synthetic ?? 0, next.synthetic ?? 0),
    compaction: Math.max(existing.compaction ?? 0, next.compaction ?? 0),
    undone_at: next.undone_at ?? existing.undone_at,
    time_created: Math.min(existing.time_created ?? next.time_created, next.time_created ?? existing.time_created),
    time_updated: Math.max(existing.time_updated ?? next.time_updated, next.time_updated ?? existing.time_updated),
    turn_duration_ms: next.turn_duration_ms ?? existing.turn_duration_ms,
  }
}

/**
 * Extracts response token counters from a message payload.
 *
 * @param {Record<string, any>} message
 * @returns {{ input: number, output: number, reasoning: number, cacheRead: number, cacheWrite: number }}
 */
function messageTokens(message) {
  return {
    input: message?.tokens?.input ?? 0,
    output: message?.tokens?.output ?? 0,
    reasoning: message?.tokens?.reasoning ?? 0,
    cacheRead: message?.tokens?.cache?.read ?? 0,
    cacheWrite: message?.tokens?.cache?.write ?? 0,
  }
}

/**
 * Builds a project fact row.
 *
 * @param {Record<string, any>} info
 * @returns {Record<string, unknown>}
 */
export function buildProject(info) {
  return {
    id: info.id,
    worktree: info.worktree,
    vcs: info.vcs ?? null,
    name: info.name ?? null,
    icon_url: info.iconUrl ?? null,
    icon_color: info.iconColor ?? null,
    time_created: info.time?.created ?? Date.now(),
    time_updated: info.time?.updated ?? info.time?.created ?? Date.now(),
    time_initialized: info.time?.initialized ?? null,
  }
}

/**
 * Walks up the parent-session chain to find all affected ancestor ids.
 *
 * @param {TrackerState} state
 * @param {string} sessionID
 * @returns {string[]}
 */
function collectAffectedSessionIDs(state, sessionID) {
  const ids = new Set()
  let current = sessionID
  while (current) {
    ids.add(current)
    current = state.parentSessionMap.get(current) ?? null
  }
  return Array.from(ids)
}

/**
 * Formats a timestamp as a UTC analytics day key.
 *
 * @param {number | null | undefined} timestamp
 * @returns {string | null}
 */
function dayKey(timestamp) {
  if (timestamp === null || timestamp === undefined) return null
  return new Date(timestamp).toISOString().slice(0, 10)
}

/**
 * Builds a session fact row.
 *
 * @param {Record<string, any>} info
 * @param {string} rootSessionID
 * @param {number | null} [deletedAt]
 * @returns {Record<string, unknown>}
 */
function buildSession(info, rootSessionID, deletedAt = null) {
  const summary = sessionSummary(info.summary)
  return {
    id: info.id,
    project_id: info.projectID,
    parent_session_id: info.parentID ?? null,
    root_session_id: rootSessionID,
    slug: info.slug,
    directory: info.directory,
    title: info.title,
    version: info.version,
    share_url: info.share?.url ?? null,
    summary_additions: summary.additions,
    summary_deletions: summary.deletions,
    summary_files: summary.files,
    archived_at: info.time?.archived ?? null,
    deleted_at: deletedAt,
    time_created: info.time?.created ?? Date.now(),
    time_updated: info.time?.updated ?? info.time?.created ?? Date.now(),
  }
}

/**
 * Builds a turn fact row.
 *
 * @param {Record<string, any>} info
 * @param {string} rootSessionID
 * @param {string} projectID
 * @param {string | null | undefined} [contentOverride]
 * @param {{ synthetic?: number, compaction?: number, undoneAt?: number | null, timeUpdated?: number, turnDurationMs?: number | null }} [extra]
 * @returns {Record<string, unknown>}
 */
function buildTurn(info, rootSessionID, projectID, contentOverride = undefined, extra = {}) {
  const content = contentOverride !== undefined ? contentOverride : null
  return {
    id: info.id,
    session_id: info.sessionID,
    root_session_id: rootSessionID,
    project_id: projectID,
    content,
    synthetic: extra.synthetic ?? 0,
    compaction: extra.compaction ?? 0,
    undone_at: extra.undoneAt ?? null,
    time_created: info.time?.created ?? Date.now(),
    time_updated: extra.timeUpdated ?? info.time?.created ?? Date.now(),
    turn_duration_ms: extra.turnDurationMs ?? null,
  }
}

/**
 * Builds an assistant response fact row.
 *
 * @param {Record<string, any>} info
 * @param {string} rootSessionID
 * @param {string} projectID
 * @returns {Record<string, unknown>}
 */
export function buildResponse(info, rootSessionID, projectID) {
  const tokens = messageTokens(info)
  const created = info.time?.created ?? Date.now()
  const completed = info.time?.completed ?? null
  return {
    id: info.id,
    turn_id: info.parentID,
    session_id: info.sessionID,
    root_session_id: rootSessionID,
    project_id: projectID,
    agent: info.agent ?? null,
    provider_id: info.providerID ?? "_unknown",
    model_id: info.modelID ?? "_unknown",
    summary: info.summary ? 1 : 0,
    finish: info.finish ?? null,
    error_type: info.error?.name ?? null,
    error_message: info.error?.message ?? info.error?.data?.message ?? null,
    cost: info.cost ?? 0,
    tokens_in: tokens.input,
    tokens_out: tokens.output,
    tokens_reasoning: tokens.reasoning,
    tokens_cache_read: tokens.cacheRead,
    tokens_cache_write: tokens.cacheWrite,
    time_created: created,
    time_completed: completed,
    response_time_ms: completed ? Math.max(0, completed - created) : null,
  }
}

/**
 * Builds a response part row when the part carries textual content.
 *
 * @param {Record<string, any>} part
 * @returns {Record<string, unknown> | null}
 */
function buildResponsePart(part) {
  const content = textValue(part.text)
  if (!content) return null
  return {
    response_id: part.messageID,
    part_id: part.id,
    part_type: part.type,
    sort_key: part.id,
    content,
    size_bytes: byteLength(content),
  }
}

/**
 * Builds an LLM step row from a completed step part.
 *
 * @param {Record<string, any>} part
 * @param {string} responseID
 * @param {string} sessionID
 * @param {string} rootSessionID
 * @param {string} projectID
 * @param {Record<string, any>} response
 * @param {string} stepID
 * @returns {Record<string, unknown>}
 */
function buildStep(part, responseID, sessionID, rootSessionID, projectID, response, stepID) {
  const startedAt = part.time?.start ?? response.time_created ?? Date.now()
  const updatedAt = part.time?.end ?? part.time?.updated ?? startedAt
  return {
    id: stepID,
    response_id: responseID,
    session_id: sessionID,
    root_session_id: rootSessionID,
    project_id: projectID,
    provider_id: response.provider_id,
    model_id: response.model_id,
    finish_reason: part.reason ?? null,
    cost: part.cost ?? 0,
    tokens_in: part.tokens?.input ?? 0,
    tokens_out: part.tokens?.output ?? 0,
    tokens_reasoning: part.tokens?.reasoning ?? 0,
    tokens_cache_read: part.tokens?.cache?.read ?? 0,
    tokens_cache_write: part.tokens?.cache?.write ?? 0,
    time_created: startedAt,
    time_updated: updatedAt,
  }
}

/**
 * Builds one tool call row plus optional payload rows.
 *
 * @param {Record<string, any>} part
 * @param {string} responseID
 * @param {string} sessionID
 * @param {string} rootSessionID
 * @param {string} projectID
 * @param {string | null} stepID
 * @returns {{ call: Record<string, unknown>, payloads: Record<string, unknown>[] }}
 */
export function buildToolCall(part, responseID, sessionID, rootSessionID, projectID, stepID) {
  const state = part.state
  const inputContent = textValue(state?.input)
  const outputContent = textValue(state?.output)
  const startedAt = state?.time?.start ?? null
  const completedAt = state?.time?.end ?? null
  const updatedAt = state?.time?.end ?? state?.time?.compacted ?? state?.time?.start ?? Date.now()
  return {
    call: {
      id: part.id,
      response_id: responseID,
      session_id: sessionID,
      root_session_id: rootSessionID,
      project_id: projectID,
      step_id: stepID,
      call_id: part.callID,
      tool: part.tool,
      status: state?.status ?? "pending",
      title: state?.title ?? null,
      error: state?.error ?? null,
      input_bytes: byteLength(inputContent),
      output_bytes: byteLength(outputContent),
      compacted_at: state?.time?.compacted ?? null,
      started_at: startedAt,
      completed_at: completedAt,
      duration_ms: startedAt && completedAt ? Math.max(0, completedAt - startedAt) : null,
      time_updated: updatedAt,
    },
    payloads: [
      inputContent
        ? {
            tool_call_id: part.id,
            payload_type: "input",
            content: inputContent,
            size_bytes: byteLength(inputContent),
          }
        : null,
      outputContent
        ? {
            tool_call_id: part.id,
            payload_type: "output",
            content: outputContent,
            size_bytes: byteLength(outputContent),
          }
        : null,
    ].filter(Boolean),
  }
}

/**
 * Normalizes one OpenCode event into fact rows and touched invalidation keys.
 *
 * @param {Record<string, any>} event
 * @param {TrackerState} state
 * @returns {NormalizedEventPayload}
 */
export function normalizeEvent(event, state) {
  const facts = {
    projects: [],
    sessions: [],
    turns: [],
    responses: [],
    response_parts: [],
    llm_steps: [],
    tool_calls: [],
    tool_payloads: [],
  }
  const touched = {
    projectIDs: new Set(),
    sessionIDs: new Set(),
    rootSessionIDs: new Set(),
    days: new Set(),
    projectDayKeys: new Set(),
    modelKeys: new Set(),
    toolKeys: new Set(),
  }

  const remember = ({ projectID, sessionID, rootSessionID, timestamp, modelID, providerID, tool, extraTimestamps = [] }) => {
    const timestamps = [timestamp, ...extraTimestamps].filter((value) => value !== null && value !== undefined)
    if (projectID) touched.projectIDs.add(projectID)
    if (sessionID) {
      for (const id of collectAffectedSessionIDs(state, sessionID)) {
        touched.sessionIDs.add(id)
      }
    }
    if (rootSessionID) touched.rootSessionIDs.add(rootSessionID)
    for (const value of timestamps) {
      const day = dayKey(value)
      if (!day) continue
      touched.days.add(day)
      if (projectID) touched.projectDayKeys.add(JSON.stringify([day, projectID]))
    }
    const modelDay = dayKey(timestamp ?? Date.now())
    if (modelDay && (modelID || providerID)) touched.modelKeys.add(JSON.stringify([modelDay, modelID ?? "_unknown", providerID ?? "_unknown"]))
    if (tool) {
      for (const value of timestamps.length > 0 ? timestamps : [Date.now()]) {
        const toolDay = dayKey(value)
        if (toolDay) touched.toolKeys.add(JSON.stringify([toolDay, tool]))
      }
    }
  }

  const emitTurn = (row) => {
    const merged = mergeTurnRows(state.turnRowMap.get(row.id), row)
    state.turnRowMap.set(row.id, merged)
    facts.turns.push(merged)
  }

  const touchSessionLineage = (sessionID) => {
    for (const id of collectAffectedSessionIDs(state, sessionID)) {
      touched.sessionIDs.add(id)
    }
  }

  switch (event.type) {
    case "session.created":
    case "session.updated": {
      const info = event.properties.info
      const rootSessionID = info.parentID ? state.rootSessionMap.get(info.parentID) ?? info.parentID : info.id
      state.rootSessionMap.set(info.id, rootSessionID)
      state.parentSessionMap.set(info.id, info.parentID ?? null)
      state.sessionProjectMap.set(info.id, info.projectID)
      facts.sessions.push(buildSession(info, rootSessionID))
      touched.projectIDs.add(info.projectID)
      touchSessionLineage(info.id)
      touched.rootSessionIDs.add(rootSessionID)
      break
    }
    case "session.deleted": {
      const info = event.properties.info
      const rootSessionID = state.rootSessionMap.get(info.id) ?? info.parentID ?? info.id
      const deletedAt = info.time?.deleted ?? Date.now()
      state.rootSessionMap.set(info.id, rootSessionID)
      state.parentSessionMap.set(info.id, info.parentID ?? null)
      state.sessionProjectMap.set(info.id, info.projectID)
      facts.sessions.push(buildSession(info, rootSessionID, deletedAt))
      touched.projectIDs.add(info.projectID)
      touchSessionLineage(info.id)
      touched.rootSessionIDs.add(rootSessionID)
      break
    }
    case "message.updated": {
      const info = event.properties.info
      const projectID = state.sessionProjectMap.get(info.sessionID) ?? state.projectID ?? "_unknown"
      const rootSessionID = state.rootSessionMap.get(info.sessionID) ?? info.sessionID
      if (info.role === "user") {
        state.turnCreatedMap.set(info.id, info.time?.created ?? Date.now())
        emitTurn(buildTurn(info, rootSessionID, projectID))
        remember({ projectID, sessionID: info.sessionID, rootSessionID, timestamp: info.time?.created })
      }
      if (info.role === "assistant") {
        const response = buildResponse(info, rootSessionID, projectID)
        facts.responses.push(response)
        state.responseMap.set(info.id, response)
        const completedAt = info.time?.completed
        if (info.parentID && completedAt && info.finish && info.finish !== "tool-calls") {
          const turnCreatedAt = state.turnCreatedMap.get(info.parentID)
          if (turnCreatedAt && completedAt >= turnCreatedAt) {
            emitTurn({
              id: info.parentID,
              session_id: info.sessionID,
              root_session_id: rootSessionID,
              project_id: projectID,
              content: null,
              synthetic: 0,
              compaction: 0,
              undone_at: null,
              time_created: turnCreatedAt,
              time_updated: completedAt,
              turn_duration_ms: completedAt - turnCreatedAt,
            })
          }
        }
        remember({
          projectID,
          sessionID: info.sessionID,
          rootSessionID,
          timestamp: info.time?.created,
          modelID: response.model_id,
          providerID: response.provider_id,
        })
      }
      break
    }
    case "message.removed": {
      const sessionID = event.properties.sessionID
      const messageID = event.properties.messageID
      const projectID = state.sessionProjectMap.get(sessionID) ?? state.projectID ?? "_unknown"
      const rootSessionID = state.rootSessionMap.get(sessionID) ?? sessionID
      const removedAt = event.properties.time?.removed ?? Date.now()
      const previousTurn = state.turnRowMap.get(messageID)
      emitTurn({
        id: messageID,
        session_id: sessionID,
        root_session_id: rootSessionID,
        project_id: projectID,
        content: null,
        synthetic: 0,
        compaction: 0,
        undone_at: removedAt,
        time_created: removedAt,
        time_updated: removedAt,
        turn_duration_ms: null,
      })
      remember({
        projectID,
        sessionID,
        rootSessionID,
        timestamp: removedAt,
        extraTimestamps: [previousTurn?.time_created ?? null],
      })
      break
    }
    case "message.part.updated": {
      const part = event.properties.part
      const projectID = state.sessionProjectMap.get(part.sessionID) ?? state.projectID ?? "_unknown"
      const rootSessionID = state.rootSessionMap.get(part.sessionID) ?? part.sessionID
      const response = state.responseMap.get(part.messageID)
      const partTimestamp = part.time?.end ?? part.time?.updated ?? part.time?.start ?? Date.now()
      if (part.type === "text") {
        if (response) {
          const payload = buildResponsePart(part)
          if (payload) facts.response_parts.push(payload)
        } else {
          const content = textValue(part.text)
          emitTurn({
            id: part.messageID,
            session_id: part.sessionID,
            root_session_id: rootSessionID,
            project_id: projectID,
            content,
            synthetic: part.synthetic ? 1 : 0,
            compaction: 0,
            undone_at: null,
            time_created: part.time?.start ?? partTimestamp,
            time_updated: partTimestamp,
            turn_duration_ms: null,
          })
        }
        remember({ projectID, sessionID: part.sessionID, rootSessionID, timestamp: partTimestamp })
      }
      if (part.type === "reasoning" && response) {
        const payload = buildResponsePart(part)
        if (payload) facts.response_parts.push(payload)
        remember({ projectID, sessionID: part.sessionID, rootSessionID, timestamp: partTimestamp })
      }
      if (part.type === "compaction") {
        emitTurn({
          id: part.messageID,
          session_id: part.sessionID,
          root_session_id: rootSessionID,
          project_id: projectID,
          content: null,
          synthetic: 1,
          compaction: 1,
          undone_at: null,
          time_created: part.time?.start ?? partTimestamp,
          time_updated: partTimestamp,
          turn_duration_ms: null,
        })
        remember({ projectID, sessionID: part.sessionID, rootSessionID, timestamp: partTimestamp })
      }
      if (part.type === "step-start") {
        state.messageStepMap.set(part.messageID, part.id)
      }
      if (part.type === "step-finish" && response) {
        const stepID = state.messageStepMap.get(part.messageID) ?? part.id
        const step = buildStep(part, part.messageID, part.sessionID, rootSessionID, projectID, response, stepID)
        facts.llm_steps.push(step)
        state.messageStepMap.set(part.messageID, stepID)
        remember({
          projectID,
          sessionID: part.sessionID,
          rootSessionID,
          timestamp: step.time_created,
          modelID: step.model_id,
          providerID: step.provider_id,
        })
      }
      if (part.type === "tool" && response) {
        const previousToolDay = state.toolDayMap.get(part.id) ?? null
        const toolCall = buildToolCall(
          part,
          part.messageID,
          part.sessionID,
          rootSessionID,
          projectID,
          state.messageStepMap.get(part.messageID) ?? null,
        )
        facts.tool_calls.push(toolCall.call)
        facts.tool_payloads.push(...toolCall.payloads)
        const currentToolDay = dayKey(toolCall.call.started_at ?? toolCall.call.time_updated)
        if (currentToolDay) state.toolDayMap.set(part.id, currentToolDay)
        remember({
          projectID,
          sessionID: part.sessionID,
          rootSessionID,
          timestamp: toolCall.call.started_at ?? toolCall.call.time_updated,
          tool: toolCall.call.tool,
          extraTimestamps: previousToolDay ? [Date.parse(`${previousToolDay}T00:00:00.000Z`)] : [],
        })
      }
      break
    }
    default:
      break
  }

  return {
    facts,
    touched: {
      projectIDs: Array.from(touched.projectIDs),
      sessionIDs: Array.from(touched.sessionIDs),
      rootSessionIDs: Array.from(touched.rootSessionIDs),
      days: Array.from(touched.days),
      projectDayKeys: Array.from(touched.projectDayKeys).map((value) => JSON.parse(value)),
      modelKeys: Array.from(touched.modelKeys).map((value) => JSON.parse(value)),
      toolKeys: Array.from(touched.toolKeys).map((value) => JSON.parse(value)),
    },
  }
}

/**
 * Creates the mutable in-memory tracker state.
 *
 * @param {Record<string, any> | undefined} project
 * @returns {TrackerState}
 */
export function createTrackerState(project) {
  const state = {
    projectID: project?.id ?? null,
    rootSessionMap: new Map(),
    parentSessionMap: new Map(),
    sessionProjectMap: new Map(),
    messageStepMap: new Map(),
    responseMap: new Map(),
    turnRowMap: new Map(),
    turnCreatedMap: new Map(),
    toolDayMap: new Map(),
  }
  if (project?.id) {
    state.projectID = project.id
  }
  return state
}

/**
 * Seeds session ancestry/project ownership maps from a session record.
 *
 * @param {TrackerState} state
 * @param {{ id?: string, projectID?: string, parentID?: string | null }} session
 * @returns {void}
 */
export function rememberSessionProject(state, session) {
  if (!session?.id || !session?.projectID) return
  state.sessionProjectMap.set(session.id, session.projectID)
  state.parentSessionMap.set(session.id, session.parentID ?? null)
  state.rootSessionMap.set(session.id, session.parentID ? state.rootSessionMap.get(session.parentID) ?? session.parentID : session.id)
}
