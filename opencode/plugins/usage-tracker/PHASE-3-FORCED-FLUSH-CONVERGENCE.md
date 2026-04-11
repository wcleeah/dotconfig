# Phase 3: Forced Flush Convergence

## Quick Check

1. Dependency status: Phase 2 must be complete.
2. Can an agent start now: yes, if timer-driven rollups already work and hot-path reads are gone before the timer fires.
3. Main outcome: `queue.flush()` becomes a deterministic convergence boundary for both facts and rollups.

## What This Phase Is About

Phase 2 introduces eventual consistency. Phase 3 defines when the system must stop being eventual and become immediate.

The forcing boundary is `queue.flush()`.

After this phase, `queue.flush()` should mean:

1. all pending fact batches have been persisted or sent to outbox
2. all currently dirty rollup invalidations have been recomputed
3. replayed outbox batches have also contributed to rollup convergence
4. no timer needs to fire later to finish already-requested work

This is important for:

1. maintenance tools
2. process exit
3. deterministic tests

## Scope

In scope:

1. `plugins/usage-tracker/queue.js`
2. `plugins/usage-tracker/test/queue.test.js`
3. `plugins/usage-tracker/index.js` only if hooks need a small adjustment or comment

Out of scope:

1. crash durability across process restarts
2. SQL optimization

## Dependencies

Required completed work:

1. `PHASE-2-BACKGROUND-ROLLUP-SCHEDULING.md`

Required state before starting:

1. background rollup timer behavior exists
2. hot-path `queryCount === 0` before timer is already passing in queue tests
3. timer-driven recomputation is already passing in queue tests

## Can Start When

An agent can start this phase when all of these are true:

1. the queue now has separate pending fact work and pending rollup work
2. there is at least one test prepared to assert `flush()` semantics
3. timer-driven recomputation does not depend on wall-clock timing

## Stop And Investigate If

1. `queue.flush()` returns while a rollup timer is still required to finish existing work
2. outbox replay writes facts but leaves their rollups stale until a later timer run
3. concurrent timer and flush paths can race and duplicate or lose dirty touched keys

## Target Measurements

Primary target:

1. after `queue.flush()`, no currently pending rollup work remains unfinished

Concrete test targets:

1. `replaceRollupsCount > 0` after `queue.flush()` when dirty rollups exist but the timer has not fired
2. no pending rollup timer remains after `queue.flush()` completes
3. replayed outbox batches also end with recomputed rollups before `queue.flush()` returns

## Files Likely To Change

Primary file:

1. `plugins/usage-tracker/queue.js`

Supporting files:

1. `plugins/usage-tracker/test/queue.test.js`
2. `plugins/usage-tracker/index.js` only if necessary for a maintenance hook comment or small behavior cleanup

## Implementation Details

### 1. Define The Exact `flush()` Order

Recommended order:

1. cancel the fact batching timer
2. materialize any pending in-memory facts into the process queue
3. drain fact batches with `processLoop()`
4. cancel the rollup timer
5. run `flushRollups()` synchronously
6. replay process outbox batches
7. run `flushRollups()` again in case replay introduced new dirty touched keys

This order is the simplest path to deterministic convergence.

### 2. Ensure Timer State Is Cleaned Up

After `queue.flush()` returns, the queue should not still depend on an old timer handle from work that existed before the call.

That means:

1. clear the timer handle if present
2. avoid double-running the same scheduled callback
3. reschedule only for new work that arrives after the flush boundary

### 3. Handle Re-Entrancy Carefully

Possible edge cases:

1. `flush()` called while a rollup run is already in progress
2. new writes arrive while `flushRollups()` is executing
3. outbox replay adds more dirty touched keys than the first forced rollup pass saw

Recommended rule:

1. `flush()` should not return until the queue reaches a stable no-pending-work state for the work visible at flush time

### 4. Keep Hook Semantics Simple

`index.js` already calls `queue.flush()` for:

1. maintenance tools
2. `exit`

Prefer to keep those hooks unchanged and make `queue.flush()` itself authoritative.

## Verification

Run:

```bash
bun test plugins/usage-tracker/test/queue.test.js
```

Specifically confirm:

1. a test where dirty rollups exist but the timer has not fired yet still converges on `queue.flush()`
2. a test with outbox replay also converges before `queue.flush()` returns
3. no pending timer remains after the flush boundary

Optional full suite check:

```bash
bun test plugins/usage-tracker/test
```

## Exit Criteria

This phase is complete when all of these are true:

1. `queue.flush()` is a deterministic convergence boundary for both facts and rollups
2. maintenance tool paths no longer rely on a later timer to finish existing work
3. process exit semantics remain safe and predictable
4. tests cover flush without depending on real time

## Handoff To Phase 4

Phase 4 starts from a queue that already has:

1. deferred timer-based rollups during normal operation
2. forced deterministic convergence on explicit flush

The remaining question is failure handling and durability, especially the crash window between successful fact writes and a later rollup timer.
