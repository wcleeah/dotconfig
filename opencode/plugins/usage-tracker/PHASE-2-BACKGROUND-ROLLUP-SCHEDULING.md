# Phase 2: Background Rollup Scheduling

## Quick Check

1. Dependency status: Phase 0 must be complete. Phase 1 should be complete or developed in the same branch.
2. Can an agent start now: yes, if the queue tests can already express the future contract.
3. Main outcome: fact writes stay immediate, and rollup recomputation moves onto a slow background timer.

## What This Phase Is About

This is the core behavior change.

Today, `flushBatch()` writes facts and immediately recomputes rollups. This phase breaks that coupling.

After this phase:

1. fact writes remain immediate
2. touched rollup keys are accumulated in memory
3. a background timer recomputes rollups later
4. nearby batches are coalesced into one rollup pass

This phase is where the primary read reduction should appear.

## Scope

In scope:

1. `plugins/usage-tracker/queue.js`
2. `plugins/usage-tracker/test/queue.test.js`
3. `plugins/usage-tracker/index.d.ts` if new queue options need types

Out of scope:

1. full durability across process crashes
2. SQL rewrites in `rollups.js`
3. redesigning outbox storage

## Dependencies

Required completed work:

1. `PHASE-0-MEASUREMENT-HARNESS.md`

Strongly recommended completed work:

1. `PHASE-1-END-STATE-TESTS.md`

Required preconditions:

1. the baseline harness can show that the old path issues rollup reads inline
2. fake timers can be advanced deterministically
3. the queue tests cover the representative event sequence

## Can Start When

An agent can start this phase when all of these are true:

1. the desired-state tests for pre-timer and post-timer behavior exist or are being authored in the same branch
2. the queue accepts injected timeout functions
3. the current hot path still shows `queryCount > 0` before any deferral logic is added

## Stop And Investigate If

1. hot-path `queryCount` is still non-zero after the refactor and before the timer fires
2. the timer keeps getting postponed forever under bursty load
3. fact write failures accidentally schedule successful rollup work for data that never committed

## Target Measurements

Primary target:

1. `hot_path_query_count_before_timer === 0`

Secondary targets:

1. `replaceRollupsCountBeforeTimer === 0`
2. `scheduledRollupTimers === 1` for a burst before the timer fires
3. `replaceRollupsCountAfterOneTimer === 1` for a simple burst
4. `eventual_query_count_after_timer > 0`

Expected improvement:

1. the visible read pressure moves off the synchronous fact write path
2. multiple nearby batches are merged into fewer rollup passes

## Files Likely To Change

Primary file:

1. `plugins/usage-tracker/queue.js`

Supporting file:

1. `plugins/usage-tracker/test/queue.test.js`

Only touch these later files if the refactor truly requires it:

1. `plugins/usage-tracker/index.d.ts`
2. `plugins/usage-tracker/index.js`

Do not rewrite `rollups.js` in this phase.

## Implementation Details

### 1. Split Fact Writes From Rollup Refresh

Refactor the queue so `flushBatch(batch)` is responsible for fact persistence only.

Recommended post-write behavior:

1. call `await init()`
2. call `await turso.writeFacts(batch.facts)`
3. merge `batch.touched` into a new in-memory accumulator such as `pendingRollupTouched`
4. schedule a rollup timer if one is not already scheduled

### 2. Introduce Separate Rollup Queue State

Recommended new state variables:

1. `pendingRollupTouched`
2. `rollupTimer`
3. `rollupRunning`
4. `rollupDelayMs` option with a default of `15000`

Recommended helper:

1. `hasTouched(touched)` to avoid duplicated emptiness checks

### 3. Add `scheduleRollupFlush()`

This helper should:

1. no-op if the queue is closed
2. no-op if a rollup timer already exists
3. schedule one timer for `rollupDelayMs`
4. clear the timer handle before calling `flushRollups()`

The timer should not be pushed forward indefinitely just because more writes arrive. The whole point is to coalesce bursts, not to starve rollups.

### 4. Add `flushRollups()`

Recommended flow:

1. exit if the queue is closed
2. exit if a rollup run is already in progress
3. exit if there are no pending touched keys
4. move the current dirty touched set into a local variable
5. clear `pendingRollupTouched`
6. call `recomputeTouchedRollups(turso, touched)`
7. call `turso.replaceRollups(rollups)`
8. if the run fails, merge the touched keys back into `pendingRollupTouched`
9. if new keys arrived during the run, schedule one more pass afterward

### 5. Preserve Existing Fact Failure Semantics

The outbox still belongs to fact write failures.

Do not mark rollup work as complete if `writeFacts()` failed and the batch was diverted to outbox.

The safe rule is:

1. only merge `batch.touched` into pending rollup invalidation state after `writeFacts()` succeeds

### 6. Keep Phase Boundaries Clean

This phase may make the minimum `flush()` adjustments needed to avoid stranding dirty rollup state, but Phase 3 owns the final explicit-flush semantics.

Avoid turning Phase 2 into a broad shutdown and durability refactor.

## Verification

Run:

```bash
bun test plugins/usage-tracker/test/queue.test.js
```

Then confirm the core measurements from the test harness:

1. `queryCount === 0` before the background timer fires
2. `replaceRollupsCount === 0` before the background timer fires
3. after one timer callback, rollups are recomputed
4. one timer run can cover several batches queued before it fires

Optional full suite check:

```bash
bun test plugins/usage-tracker/test
```

## Exit Criteria

This phase is complete when all of these are true:

1. fact writes no longer trigger immediate rollup recomputation
2. hot-path rollup reads are zero before the timer fires
3. a timer-driven pass still recomputes rollups later
4. burst activity is coalesced into fewer rollup passes
5. no existing queue or outbox semantics regress for fact write failures

## Handoff To Phase 3

Phase 3 assumes there is now a separate pending rollup state in the queue.

The next phase will formalize deterministic convergence for:

1. explicit `queue.flush()`
2. maintenance tool flows
3. shutdown behavior
