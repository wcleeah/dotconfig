# Phase 4: Failure And Durability

## Quick Check

1. Dependency status: Phase 3 must be complete.
2. Can an agent start now: yes, if timer-driven rollups and forced flush semantics are already working.
3. Main outcome: the deferred-rollup design is made resilient enough for real use, and the remaining crash tradeoff is explicit.

## What This Phase Is About

Phases 2 and 3 deliver the main read reduction, but they introduce a new correctness question:

1. what happens if fact writes succeed and the process dies before the rollup timer runs?

This phase handles two related concerns:

1. transient failures while recomputing deferred rollups
2. durability of dirty rollup invalidations across process failure or restart

This phase has two subpaths:

1. Phase 4A, minimum acceptable hardening
2. Phase 4B, stronger durable invalidation storage

## Scope

In scope:

1. `plugins/usage-tracker/queue.js`
2. `plugins/usage-tracker/test/queue.test.js`
3. `plugins/usage-tracker/outbox.js` only if reusing or extending outbox behavior
4. a new rollup-invalidations storage helper if Phase 4B is chosen
5. documentation updates describing the final tradeoff

Out of scope:

1. SQL performance rewrites in `rollups.js`
2. schema redesign

## Dependencies

Required completed work:

1. `PHASE-3-FORCED-FLUSH-CONVERGENCE.md`

Required state before starting:

1. hot-path reads are already zero before the timer fires
2. timer-driven rollup recomputation already works
3. `queue.flush()` already forces convergence

## Can Start When

An agent can start this phase when all of these are true:

1. the normal-path performance target has already been met
2. there is explicit agreement on whether Phase 4A is enough or whether Phase 4B is required now
3. queue tests can simulate rollup and fact failures deterministically

## Decision Gate

Choose the subpath before coding:

1. choose Phase 4A if the immediate goal is operational safety for transient failures and the crash window is acceptable for now
2. choose Phase 4B if rollup staleness across process crash or restart is not acceptable

If no decision has been made, start with Phase 4A and document the remaining crash window clearly.

## Stop And Investigate If

1. transient rollup failure can silently drop dirty touched keys
2. `queue.flush()` after a transient failure still leaves dirty work behind
3. durable storage is added, but restart recovery is not covered by tests

## Target Measurements

### Required For Phase 4A

1. after one forced rollup failure, dirty keys are still present for retry
2. after the next timer run or explicit flush, rollups converge successfully
3. no dirty touched keys are silently lost during transient failure

### Required For Phase 4B

1. after a simulated process restart, pending rollup invalidations are still discoverable
2. replay or startup recovery eventually recomputes those rollups
3. restart recovery does not duplicate successful rollup application indefinitely

## Files Likely To Change

Primary file:

1. `plugins/usage-tracker/queue.js`

Supporting files:

1. `plugins/usage-tracker/test/queue.test.js`
2. `plugins/usage-tracker/outbox.js` if reusing durable storage primitives
3. a new helper such as `rollup-outbox.js` if Phase 4B is chosen
4. `plugins/usage-tracker/BACKGROUND-ROLLUP-PLAN.md` or this runbook to document the final tradeoff

## Implementation Details

### Phase 4A: Minimum Acceptable Hardening

This subpath is the default if the goal is to finish the main timer-based design safely without adding new durable storage yet.

Required behavior:

1. if `recomputeTouchedRollups()` fails, merge the dirty touched set back into pending state
2. if `replaceRollups()` fails, merge the dirty touched set back into pending state
3. schedule another timer pass if dirty work remains after failure
4. keep `queue.flush()` as a deterministic recovery path
5. document that a hard crash between fact write success and the later timer still leaves a stale-rollup window

This is acceptable if the team has already agreed that eventual consistency plus clean-exit flush is sufficient for now.

### Phase 4B: Durable Pending Rollup Invalidations

Choose this subpath if the crash window is not acceptable.

Recommended design:

1. persist dirty rollup touched keys after fact writes succeed and before returning control to the hot path
2. load durable dirty invalidations on startup or queue initialization
3. merge newly observed dirty keys into the durable invalidation store
4. remove or mark durable invalidations complete only after `replaceRollups()` succeeds

Recommended storage shapes:

1. one durable file per pending invalidation batch
2. one merged durable state per process
3. reuse outbox-like atomic write and rename behavior

Preferred implementation style:

1. keep durable rollup invalidation storage separate from fact outbox storage unless the shared abstraction is obviously cleaner

### Do Not Expand Scope Prematurely

Do not use this phase to rewrite rollup SQL. By the time this phase starts, the main read-pressure win should already be achieved.

If background rollups are still too expensive after Phase 4, that is a separate follow-up.

## Verification

Run:

```bash
bun test plugins/usage-tracker/test/queue.test.js
```

Then verify the chosen subpath.

For Phase 4A, confirm:

1. a transient rollup failure does not lose dirty keys
2. retry succeeds on a later timer pass or explicit flush

For Phase 4B, confirm:

1. durable dirty invalidations survive simulated restart
2. startup or replay recovery recomputes those rollups

Recommended broader check if storage helpers change:

```bash
bun test plugins/usage-tracker/test
```

## Exit Criteria

Phase 4A is complete when all of these are true:

1. transient rollup failures do not drop dirty work
2. retry paths are covered by tests
3. the remaining hard-crash tradeoff is documented explicitly

Phase 4B is complete when all of these are true:

1. durable pending rollup invalidations survive restart
2. restart recovery is covered by tests
3. successful rollup application clears durable dirty state correctly

## What Comes Next

The next phase after this runbook is an optional optimization phase documented in:

1. `plugins/usage-tracker/PHASE-5-SQL-OPTIMIZATIONS.md`

Do not start that SQL optimization work until the Phase 2 and Phase 3 behavior changes are already stable and measured.
