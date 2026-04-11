# Usage Tracker Background Rollup Plan

## Goal

Reduce `usage-tracker` read pressure by removing rollup recomputation from the hot write path and moving it to a slow background timer, while keeping fact writes immediate and preserving eventual consistency.

The first implementation target is not "perfectly optimized rollup SQL." The first target is:

1. Fact writes stay immediate.
2. Hot-path read queries drop to near zero before the timer fires.
3. Rollups still converge automatically after a bounded delay.
4. `queue.flush()` and process exit still force convergence.
5. We add tests that make future read regressions obvious.

## Why This Is Needed

The current design couples every successful fact write with immediate rollup refresh:

1. `index.js` wires `event -> queue.enqueue(event)`.
2. `queue.js` batches normalized facts and touched keys.
3. `flushBatch()` writes facts.
4. `flushBatch()` immediately calls `recomputeTouchedRollups()`.
5. `rollups.js` fans out into multiple query families and issues many `turso.query()` calls per touched key.

That means a single user-visible event can trigger a small write plus many follow-up reads. The reads are especially expensive because:

1. Session lineage expands one event into multiple touched session IDs.
2. Some rollup families loop one key at a time.
3. Daily rollups compute multiple families for the same underlying event.
4. Some queries do extra existence/count reads in addition to the main aggregate read.

This makes read volume scale with activity in a way that is much more aggressive than the fact write volume.

## Current Hotspots

The main synchronous read hotspot is `queue.js -> recomputeTouchedRollups()`.

The current call chain is:

```text
event
  -> normalizeEvent()
  -> queue.enqueue()
  -> flushBatch()
  -> turso.writeFacts(...)
  -> recomputeTouchedRollups(...)
  -> turso.query(...) many times
  -> turso.replaceRollups(...)
```

Key files involved:

1. `plugins/usage-tracker/queue.js`
2. `plugins/usage-tracker/rollups.js`
3. `plugins/usage-tracker/normalize.js`
4. `plugins/usage-tracker/history.js`

Important note:

1. `history.js` does local SQLite hydration reads and should stay as-is initially.
2. The bigger immediate win is to stop Turso rollup reads from happening inline with fact writes.

## Desired Behavior

After the change, the write path should behave like this:

```text
event
  -> normalizeEvent()
  -> queue.enqueue()
  -> flushBatch()
  -> turso.writeFacts(...)
  -> merge touched keys into pending rollup invalidations
  -> return

later, on timer or explicit flush:
  -> recomputeTouchedRollups(...)
  -> turso.replaceRollups(...)
```

This changes the system from immediate rollup consistency to bounded eventual consistency.

## Target Consistency Model

Use a slow background timer.

Recommended initial default:

1. `rollupDelayMs = 15000`

Why 15 seconds:

1. Long enough to collapse bursts of activity into one rollup pass.
2. Short enough that dashboards and ad-hoc queries still feel reasonably fresh.
3. Easy to shorten later if the measured win is large and freshness is more important than expected.

Recommended operational rules:

1. Timer-driven rollups run automatically in the background.
2. `queue.flush()` forces both pending fact writes and pending rollup recomputation immediately.
3. Process exit continues to call `queue.flush()`.
4. Manual maintenance tools continue to force convergence.

## Non-Goals For The First Change

Do not try to do all of this in the first pass:

1. Do not rewrite all rollup SQL.
2. Do not redesign schema or rollup table layout.
3. Do not remove rollup tables.
4. Do not change event normalization semantics.
5. Do not optimize local SQLite history hydration yet.

Those may be worthwhile later, but they are not required to get the first large read reduction.

## Phase Runbooks

The actionable implementation phases from this plan are split into standalone runbooks:

1. `plugins/usage-tracker/PHASE-0-MEASUREMENT-HARNESS.md`
2. `plugins/usage-tracker/PHASE-1-END-STATE-TESTS.md`
3. `plugins/usage-tracker/PHASE-2-BACKGROUND-ROLLUP-SCHEDULING.md`
4. `plugins/usage-tracker/PHASE-3-FORCED-FLUSH-CONVERGENCE.md`
5. `plugins/usage-tracker/PHASE-4-FAILURE-AND-DURABILITY.md`
6. `plugins/usage-tracker/PHASE-5-SQL-OPTIMIZATIONS.md`

These six runbooks cover the main delivery path through Phase 4 plus the optional Phase 5 SQL optimization follow-up. Phases 0 through 4 remain the main delivery path. Phase 5 should only start after the background timer design is already stable and measured.

## Implementation Strategy

### Phase 0: Measurement Harness First

Build the test harness before changing queue behavior.

Primary file:

1. `plugins/usage-tracker/test/queue.test.js`

Add a realistic fake Turso client with counters:

1. `writeFactsCount`
2. `replaceRollupsCount`
3. `queryCount`
4. `queries` array for debugging
5. optional `replaceRollupsPayloads` capture

Add a deterministic timer harness instead of sleeping in tests.

Recommended queue dependency injection points:

1. `rollupDelayMs`
2. `setTimeoutFn`
3. `clearTimeoutFn`

This keeps tests fast and deterministic. It also avoids fragile tests that depend on real clock timing.

Recommended fake timer shape:

```js
const scheduled = []

function setTimeoutFn(fn, ms) {
  const handle = { fn, ms, cleared: false }
  scheduled.push(handle)
  return handle
}

function clearTimeoutFn(handle) {
  if (handle) handle.cleared = true
}

async function runNextTimer() {
  const handle = scheduled.shift()
  if (!handle || handle.cleared) return
  await handle.fn()
}
```

### Phase 1: Add Regression Tests That Describe The Desired End State

Land tests that protect the new behavior, not the current bad behavior.

Do not land a test that permanently asserts the current high query count.
Use the counter to observe the baseline during development, but make the committed tests assert the desired future behavior.

Recommended tests:

1. `writes facts without rollup reads before the background timer fires`
2. `runs rollup recomputation after the timer callback fires`
3. `coalesces multiple event batches into one background rollup pass`
4. `flush forces pending rollups immediately`
5. `rollup failure keeps keys dirty and retries later`
6. `fact write failure still uses outbox semantics and does not mark rollups complete`

Recommended representative event sequence for the hot path:

1. `session.created`
2. user `message.updated`
3. assistant `message.updated`
4. tool `message.part.updated` with `tool: "read"`

This sequence is good because it exercises:

1. fact writes
2. session touches
3. daily touches
4. model touches
5. tool touches
6. the same path that was producing many read queries

Example test intent:

```js
expect(fakeTurso.writeFactsCount).toBeGreaterThan(0)
expect(fakeTurso.queryCount).toBe(0)
expect(fakeTurso.replaceRollupsCount).toBe(0)

await runNextTimer()

expect(fakeTurso.queryCount).toBeGreaterThan(0)
expect(fakeTurso.replaceRollupsCount).toBe(1)
```

### Phase 2: Split Fact Writes From Rollup Refresh In `queue.js`

Refactor the queue so fact writes and rollup recomputation are separate flows.

Introduce new queue state:

1. `pendingRollupTouched`
2. `rollupTimer`
3. `rollupRunning`

Recommended behavior:

1. `flushBatch(batch)` writes facts only.
2. After successful fact write, merge `batch.touched` into `pendingRollupTouched`.
3. Schedule background rollup timer if one is not already scheduled.
4. When the timer fires, compute and write rollups for the merged dirty keys.

Pseudo-structure:

```js
async function flushBatch(batch) {
  await init()
  await turso.writeFacts(batch.facts)
  mergeTouched(pendingRollupTouched, batch.touched)
  scheduleRollupFlush()
}

function scheduleRollupFlush() {
  if (rollupTimer || closed) return
  rollupTimer = setTimeoutFn(async () => {
    rollupTimer = null
    await flushRollups()
  }, rollupDelayMs)
}

async function flushRollups() {
  if (rollupRunning || closed) return
  if (!hasTouched(pendingRollupTouched)) return

  rollupRunning = true
  const touched = pendingRollupTouched
  pendingRollupTouched = emptyTouched()

  try {
    const rollups = await recomputeTouchedRollups(turso, touched)
    await turso.replaceRollups(rollups)
  } catch (error) {
    mergeTouched(pendingRollupTouched, touched)
    logger.error("[usage-tracker] rollup flush failed", toErrorMessage(error))
  } finally {
    rollupRunning = false
    if (hasTouched(pendingRollupTouched)) scheduleRollupFlush()
  }
}
```

### Phase 3: Define Forced-Convergence Semantics Clearly

`queue.flush()` must now handle two kinds of work:

1. pending fact batches
2. pending rollup invalidations

Recommended `flush()` sequence:

1. cancel fact timer
2. enqueue pending facts if any
3. process all fact batches
4. cancel rollup timer
5. run `flushRollups()` synchronously
6. replay fact outbox
7. run `flushRollups()` again in case replay added more touched keys

This preserves deterministic behavior for:

1. explicit maintenance tool calls
2. shutdown path
3. tests that need everything converged before assertions

### Phase 4: Failure Handling And Durability Hardening

This is where the design needs careful thought.

If fact writes succeed and the process crashes before the rollup timer fires, dirty touched keys stored only in memory are lost. That would leave rollups stale until some later event happens to touch the same keys again.

That may be acceptable as an initial incremental step if:

1. we flush on normal process exit
2. we document the crash window
3. we measure whether the crash risk is acceptable in practice

But the safer long-term version is to make dirty rollup invalidations durable.

Recommended options, in order:

1. `Phase 4A, smaller`: accept in-memory dirty rollup state initially, flush on exit, and document the crash window.
2. `Phase 4B, safer`: add a second durable outbox specifically for pending rollup touched keys.
3. `Phase 4C, stronger`: unify fact and rollup durability into a single state machine if the code starts to split too much.

For the first incremental win, `Phase 4A` is probably enough. For correctness under crash/restart, `Phase 4B` is the better follow-up.

### Phase 5: Optional Follow-Up SQL Optimizations

Once the timer-based deferral lands, we can decide if the remaining background reads are still too expensive.

Possible follow-up work:

1. batch multiple rollup keys into fewer queries
2. replace row-by-row existence reads with set-based deletes
3. rewrite daily queries to use timestamp ranges instead of `date(...)`
4. collapse multi-query daily project rollups into one query
5. add targeted indexes if background rollups are still slow

These are worthwhile, but they should come after the timer change because the timer change is likely to deliver the biggest immediate drop in visible read pressure.

## Detailed Test Plan

### Test 1: Hot Path Does Not Read Before Timer

Purpose:

1. prove the user-facing event path no longer issues immediate Turso reads for rollups

Setup:

1. fake Turso client with counters
2. fake timer scheduler
3. queue configured with `rollupDelayMs`

Flow:

1. enqueue representative event sequence
2. flush fact path if needed by test structure
3. do not run timer

Assertions:

1. fact writes happened
2. `queryCount === 0`
3. `replaceRollupsCount === 0`
4. a timer was scheduled

### Test 2: Timer Eventually Recomputes Rollups

Purpose:

1. prove eventual consistency still happens automatically

Flow:

1. perform the same event sequence
2. run one scheduled timer callback

Assertions:

1. `queryCount > 0`
2. `replaceRollupsCount === 1`
3. rollup payload includes expected families

### Test 3: Multiple Batches Coalesce

Purpose:

1. prove bursts of events collapse into one background rollup pass

Flow:

1. enqueue several events or flush several fact batches before the timer runs
2. ensure only one rollup timer is active
3. run the timer once

Assertions:

1. one rollup pass occurs
2. touched keys represent the union of all earlier events

### Test 4: Explicit Flush Forces Convergence

Purpose:

1. preserve current maintenance semantics

Flow:

1. enqueue events
2. do not run timer
3. call `queue.flush()`

Assertions:

1. fact writes complete
2. rollups are recomputed immediately
3. no pending timers remain

### Test 5: Rollup Failure Retries Later

Purpose:

1. make sure eventual consistency is resilient to transient rollup failures

Setup:

1. fake Turso where `query()` or `replaceRollups()` fails once, then succeeds

Flow:

1. enqueue events
2. run timer and force one failure
3. run timer again or call `flush()`

Assertions:

1. dirty touched keys are retained after failure
2. second attempt succeeds
3. rollup writes are not silently dropped

### Test 6: Fact Write Failure Does Not Falsely Clear Rollup Work

Purpose:

1. preserve current outbox behavior and avoid pretending facts were reflected in rollups when the write failed

Assertions:

1. failed fact batch is persisted to outbox
2. rollup timer does not claim success for that batch
3. replay plus flush eventually converges

## Measurement Plan

This change should be measured in stages.

### Stage A: Development Baseline

Before changing behavior, use the new counter harness locally to observe the current query count for a representative event sequence.

Important rule:

1. observe the baseline during development
2. do not commit a regression test that locks in the bad number

What to record in notes or PR description:

1. event sequence used
2. number of `writeFacts()` calls
3. number of `query()` calls
4. number of `replaceRollups()` calls
5. number of timer flushes after the change

### Stage B: Primary Win Measurement

After the queue split lands, measure the same event sequence again.

Primary metric:

1. `hot_path_query_count_before_timer`

Success target:

1. baseline: greater than zero
2. after change: exactly zero

Secondary metrics:

1. `replaceRollupsCountBeforeTimer`
2. `scheduledRollupTimers`
3. `eventual_query_count_after_timer`

Expected result:

1. hot path reads drop to zero
2. a later background pass performs the reads instead
3. total reads per burst should usually drop because multiple events are coalesced

### Stage C: Burst Coalescing Measurement

Run several event sequences before the timer fires.

Measure:

1. total write count
2. total query count after one timer flush
3. rollup pass count

Success target:

1. many event bursts should collapse into one rollup pass
2. background query count should be lower than the sum of immediate per-event recomputes

### Stage D: Eventual Freshness Measurement

Measure how stale rollups can be under the new timer.

Metric:

1. `rollup_visibility_lag_ms`

Definition:

1. time between fact write completion and successful rollup replacement for the touched keys

Initial target:

1. less than or equal to `rollupDelayMs + one rollup execution`

### Stage E: Failure Recovery Measurement

Force a temporary rollup failure.

Measure:

1. whether dirty keys are retried
2. how many retry attempts occur
3. whether `flush()` guarantees convergence after the failure is removed

Success target:

1. no dropped dirty keys
2. no permanent stale rollups after transient failure plus explicit flush

## Incremental Wins

The work can deliver value in layers.

### Win 1: Query Visibility

Change:

1. add fake Turso counters and deterministic timer injection

Value:

1. we stop guessing
2. we can prove whether later changes help or not

Evidence:

1. tests show query counts and timer behavior clearly

### Win 2: Remove Hot-Path Rollup Reads

Change:

1. move rollup recomputation off the synchronous fact write path

Value:

1. biggest likely reduction in visible read pressure
2. user-facing events become cheaper immediately

Evidence:

1. `queryCount === 0` before timer in queue tests

### Win 3: Burst Coalescing

Change:

1. merge dirty touched keys across multiple batches until the timer fires

Value:

1. one rollup pass can cover several events
2. total reads per unit of activity should fall further

Evidence:

1. one timer run handles several earlier writes

### Win 4: Safe Forced Flush

Change:

1. make `queue.flush()` force pending rollups immediately

Value:

1. maintenance tooling and shutdown remain deterministic

Evidence:

1. flush test proves full convergence

### Win 5: Durable Rollup Invalidation, Optional Follow-Up

Change:

1. persist dirty rollup touched keys across crashes

Value:

1. removes the crash window where facts exist but rollups stay stale

Evidence:

1. crash/restart simulation or durable outbox tests

## Proposed Code Changes By File

### `plugins/usage-tracker/queue.js`

Expected edits:

1. add timer injection options
2. add rollup delay option
3. add separate pending rollup accumulator
4. split `flushBatch()` into fact-write responsibility only
5. add `scheduleRollupFlush()`
6. add `flushRollups()`
7. update `flush()` to force both fact and rollup completion
8. update close/replay flows accordingly

### `plugins/usage-tracker/test/queue.test.js`

Expected edits:

1. add fake Turso counters
2. add fake timer helper
3. add hot-path no-read test
4. add timer-driven recompute test
5. add coalescing test
6. add forced flush test
7. add failure recovery test if practical in the first pass

### `plugins/usage-tracker/outbox.js`

Expected edits in first pass:

1. probably none

Possible later edits:

1. second outbox for durable pending rollup invalidations

### `plugins/usage-tracker/rollups.js`

Expected edits in first pass:

1. none required for the timer change

Possible later edits:

1. query batching
2. range-query rewrites
3. elimination of extra existence reads

## Suggested Rollout Order

1. add test harness and desired-state tests
2. refactor queue to defer rollups via timer
3. make `flush()` force convergence
4. run full usage-tracker test suite
5. evaluate whether crash-window durability is acceptable
6. if needed, add durable rollup invalidation storage
7. only then decide whether SQL-level optimization is still worth doing

## Commands To Use During Development

Run targeted queue tests:

```bash
bun test plugins/usage-tracker/test/queue.test.js
```

Run the whole plugin test suite:

```bash
bun test plugins/usage-tracker/test
```

If a temporary development-only counter log is useful, add it behind an env flag so normal output stays clean.

Example idea:

1. `USAGE_TRACKER_DEBUG_ROLLUPS=1`

Potential debug output:

1. fact batch sizes
2. touched key counts
3. timer scheduling
4. rollup run count
5. query count per rollup pass

This should stay optional and should not be required for the core change.

## Acceptance Criteria

The first implementation is successful if all of these are true:

1. queue tests prove no rollup reads happen before the timer fires
2. queue tests prove timer-driven recomputation still happens
3. queue tests prove `flush()` forces convergence
4. multiple event bursts are coalesced into fewer rollup passes
5. no existing normalization or outbox tests regress
6. the code remains easy to follow and minimally invasive

## Risks And Tradeoffs

### Risk 1: Stale Rollups For Up To The Timer Window

This is intentional and acceptable under the chosen consistency model.

Mitigation:

1. keep the timer reasonably short
2. keep explicit flush deterministic

### Risk 2: Crash Between Fact Write And Timer-Driven Rollup

This is the main correctness tradeoff of the simple first pass.

Mitigation options:

1. accept initially and flush on clean exit
2. add durable rollup invalidation storage in follow-up work

### Risk 3: Background Rollup Work Starves Under Constant Load

If new writes keep arriving continuously, the timer logic must still ensure rollups run eventually.

Mitigation:

1. do not endlessly postpone work just because new events arrive
2. once a timer is scheduled, let it fire and process the merged dirty set
3. if new keys arrive during a run, schedule one more pass afterward

### Risk 4: Tests Become Timing-Sensitive

Mitigation:

1. inject timer functions
2. never rely on real waiting in unit tests

## Recommendation

Build this in the following exact order:

1. test harness and desired-state queue tests
2. queue split between fact writes and timer-driven rollup recompute
3. forced flush semantics
4. evaluate whether the crash window is acceptable

That sequence gives the fastest path to an incremental win while keeping the design grounded in measurable behavior.
