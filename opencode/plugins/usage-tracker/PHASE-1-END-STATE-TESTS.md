# Phase 1: End-State Tests

## Quick Check

1. Dependency status: Phase 0 must be complete.
2. Can an agent start now: yes, if the Phase 0 harness exists and the branch strategy for test-first work is clear.
3. Main outcome: the intended background-rollup behavior is expressed as tests.

## What This Phase Is About

This phase writes the contract for the new queue behavior.

It should answer these questions in executable form:

1. What should happen before the rollup timer fires?
2. What should happen when the timer fires?
3. What should happen if several batches arrive before the timer fires?
4. What should happen on explicit `flush()`?
5. What should happen on retry paths?

This phase defines the target behavior. It does not yet implement the runtime queue change.

## Scope

In scope:

1. `plugins/usage-tracker/test/queue.test.js`
2. small helper additions if the Phase 0 harness needs a minor extension

Out of scope:

1. changing queue behavior to make the new tests pass
2. changing rollup SQL
3. durability changes

## Dependencies

Required completed work:

1. `PHASE-0-MEASUREMENT-HARNESS.md` exit criteria are satisfied

Required state before starting:

1. fake Turso counters are available
2. fake timer helpers are available
3. representative event sequence helper is available

## Can Start When

An agent can start this phase when all of these are true:

1. the current baseline can prove the hot path still reads before any timer deferral exists
2. queue tests can schedule and execute fake timers without real waiting
3. the team or branch strategy is clear about how to handle temporarily failing desired-state tests

## Landing Strategy

This phase is test-first, so there are two valid ways to deliver it:

1. preferred for a stacked branch: land the desired-state tests and Phase 2 in the same branch or changeset
2. acceptable for a long-running refactor branch: add the tests first, but do not merge a permanently red shared branch

If the repository requires green tests on every intermediate merge, Phase 1 and Phase 2 should be developed together even if they are documented separately.

## Stop And Investigate If

1. the tests assert the current bad behavior instead of the desired behavior
2. the tests depend on exact current baseline counts instead of semantic outcomes
3. the tests rely on real timing rather than the injected scheduler

## Target Measurements

This phase defines future target measurements rather than satisfying them immediately.

The desired contract to encode is:

1. before the rollup timer fires, `queryCount === 0`
2. before the rollup timer fires, `replaceRollupsCount === 0`
3. before the rollup timer fires, `writeFactsCount > 0`
4. when the timer fires, `replaceRollupsCount === 1`
5. when the timer fires, `queryCount > 0`
6. several batches before the timer should still result in one background rollup pass
7. explicit `flush()` should force convergence
8. transient rollup failure should preserve dirty work for retry

## Files Likely To Change

Primary file:

1. `plugins/usage-tracker/test/queue.test.js`

Secondary files only if the Phase 0 harness proved too narrow:

1. `plugins/usage-tracker/queue.js`
2. `plugins/usage-tracker/index.d.ts`

## Required Tests

Add the following tests or equivalent coverage:

1. `writes facts without rollup reads before the background timer fires`
2. `runs rollup recomputation after the timer callback fires`
3. `coalesces multiple event batches into one background rollup pass`
4. `flush forces pending rollups immediately`
5. `rollup failure keeps keys dirty and retries later`
6. `fact write failure still uses outbox semantics and does not mark rollups complete`

## Implementation Details

### 1. Use The Same Representative Event Sequence Everywhere

Do not let each test invent a different setup.

At minimum, the shared setup should exercise:

1. session creation
2. a user turn
3. an assistant response
4. a tool call part with `tool: "read"`

That keeps the test contract aligned with the real hotspot.

### 2. Assert Semantics, Not Accidental Current Counts

Good assertions:

1. `queryCount === 0` before timer
2. `replaceRollupsCount === 0` before timer
3. `replaceRollupsCount === 1` after timer
4. one timer run covers several earlier writes

Bad assertions:

1. exact current baseline query counts from the old implementation
2. exact SQL text for every current rollup query
3. exact current order of unrelated helper calls

### 3. Keep Failure Tests Narrow

For retry behavior, prefer controlled failpoints over broad fake behavior.

Examples:

1. fail next `query()` once, then succeed
2. fail next `replaceRollups()` once, then succeed
3. fail next `writeFacts()` once to preserve existing outbox semantics

### 4. Avoid Making The Tests Fragile

Do not require:

1. exact timer handle identities
2. exact array ordering for unrelated counters
3. exact SQL strings unless the test is explicitly about query selection

## Verification

Run:

```bash
bun test plugins/usage-tracker/test/queue.test.js
```

If this phase is delivered independently from Phase 2, the branch strategy must explicitly allow the desired-state tests to exist before they pass.

If this phase is delivered together with Phase 2, then by the end of the combined work all new tests should pass.

## Exit Criteria

This phase is complete when all of these are true:

1. the desired background-rollup contract is clearly encoded in tests
2. the tests use the Phase 0 harness instead of real timers
3. the tests do not snapshot the current bad baseline as a permanent contract
4. the intended pass conditions for Phase 2 and Phase 3 are unambiguous

## Handoff To Phase 2

Phase 2 should treat the new tests as the source of truth for queue behavior.

After Phase 2 starts, the first target to make pass is:

1. `queryCount === 0` before the background timer fires

Phase 3 will then finish the explicit flush semantics described by the later tests.
