# Phase 0: Measurement Harness

## Quick Check

1. Dependency status: none. This is the first actionable phase.
2. Can an agent start now: yes, if the current `usage-tracker` tests are runnable.
3. Main outcome: deterministic test infrastructure exists, and the current read-heavy baseline is observable.

## What This Phase Is About

This phase builds the tooling needed to measure the current hot path before changing queue behavior.

It is not the phase that reduces read volume. It creates the harness that lets later phases prove they reduced read volume.

The phase has three jobs:

1. Make queue tests deterministic.
2. Make fake Turso activity measurable.
3. Make the representative hot-path event sequence reusable.

## Scope

In scope:

1. `plugins/usage-tracker/test/queue.test.js`
2. `plugins/usage-tracker/queue.js`
3. `plugins/usage-tracker/index.d.ts` only if queue option types need documenting

Out of scope:

1. changing rollup timing semantics
2. changing rollup SQL
3. changing outbox durability rules
4. changing normalization behavior

## Dependencies

This phase has no prior implementation dependency.

It does depend on a stable local test environment:

1. `bun test plugins/usage-tracker/test/queue.test.js` must run locally
2. the existing queue tests should already be green before refactoring begins

## Can Start When

An agent can start this phase immediately when all of these are true:

1. the queue test file exists and is readable
2. `createIngestionQueue()` can be modified safely
3. there is no parallel queue refactor in progress that would make the harness stale before it lands

## Stop And Investigate If

1. the harness cannot observe any `turso.query()` calls from the current hot path
2. the test fixture does not exercise `message.part.updated` tool events
3. timer behavior still depends on real sleeps or wall-clock timing after the phase is complete

If any of those happen, the phase is incomplete even if the tests pass.

## Target Measurements

This phase does not have a performance win target yet. It has observability targets.

The harness must let later phases inspect at least these values:

1. `writeFactsCount`
2. `replaceRollupsCount`
3. `queryCount`
4. `queries` for debugging unexpected fanout
5. scheduled timer count or scheduled timer handles

The baseline measurement to capture during development is:

1. representative event sequence used
2. `writeFactsCount`
3. `queryCount`
4. `replaceRollupsCount`

Expected baseline shape before later phases:

1. `writeFactsCount > 0`
2. `queryCount > 0`
3. `replaceRollupsCount > 0`

Do not hard-code the bad baseline into committed tests. Record it in notes or a PR description only.

## Files Likely To Change

Primary files:

1. `plugins/usage-tracker/test/queue.test.js`
2. `plugins/usage-tracker/queue.js`

Possible supporting file:

1. `plugins/usage-tracker/index.d.ts`

Files that should not change in this phase unless absolutely necessary:

1. `plugins/usage-tracker/rollups.js`
2. `plugins/usage-tracker/outbox.js`
3. `plugins/usage-tracker/normalize.js`

## Implementation Details

### 1. Build A Fake Turso Client With Counters

The fake Turso client should support the exact queue interactions needed by the tests.

Recommended tracked fields:

1. `ensureSchemaCount`
2. `writeFactsCount`
3. `replaceRollupsCount`
4. `queryCount`
5. `queries`
6. `replaceRollupsPayloads`

Recommended methods:

1. `ensureSchema()`
2. `writeFacts(facts)`
3. `replaceRollups(rollups)`
4. `query(sql, args)`
5. `close()`

The fake should also support simple failure injection later, even if that is not fully used yet.

Recommended configurable failpoints:

1. fail next `writeFacts`
2. fail next `query`
3. fail next `replaceRollups`

### 2. Build A Deterministic Timer Harness

Do not rely on real `setTimeout()` in queue unit tests.

Add queue dependency injection points for:

1. `setTimeoutFn`
2. `clearTimeoutFn`
3. `rollupDelayMs`

Even if the production behavior does not use all of these yet, this phase should make them injectable so later phases stay deterministic.

Recommended fake timer behavior:

1. store scheduled callbacks in an array
2. return a handle object for each scheduled callback
3. mark handles as cleared instead of removing them eagerly
4. expose `runNextTimer()` and optionally `runAllTimers()` helpers for tests

### 3. Extract A Representative Event Sequence Helper

The test file should stop repeating low-level event literals.

Create one helper that exercises the hot path that matters for read amplification:

1. `session.created`
2. user `message.updated`
3. assistant `message.updated`
4. tool `message.part.updated` with `tool: "read"`

This sequence is the minimum realistic path that touches:

1. facts
2. sessions
3. days
4. model keys
5. tool keys
6. rollup recomputation

### 4. Keep Behavior Unchanged In This Phase

Phase 0 is allowed to add injection points and helpers, but it should not change the runtime rollup consistency model.

Specifically:

1. do not defer rollups yet
2. do not introduce pending rollup state yet
3. do not rewrite `flush()` semantics yet

If behavior changes in this phase, later measurements become harder to trust.

## Verification

Run:

```bash
bun test plugins/usage-tracker/test/queue.test.js
```

Then verify manually from the test harness or debug output:

1. a representative hot-path event sequence can be run without real sleeping
2. the fake Turso records `queryCount`
3. the current implementation still shows rollup-related reads on the hot path

Optional follow-up command:

```bash
bun test plugins/usage-tracker/test
```

## Exit Criteria

This phase is complete when all of these are true:

1. queue tests are deterministic
2. fake Turso counters exist and are easy to inspect
3. the representative event sequence exists as reusable test setup
4. the current bad baseline is observable without hard-coding it into assertions
5. no behavior change has been introduced yet

## Handoff To Phase 1

Phase 1 assumes the following artifacts exist:

1. fake Turso counter harness
2. fake timer harness
3. representative event sequence helper
4. an observed baseline showing that the current hot path still performs rollup reads

The next phase uses this harness to define the future contract without guessing.
