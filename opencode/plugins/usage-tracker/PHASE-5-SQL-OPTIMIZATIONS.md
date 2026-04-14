# Phase 5: SQL Optimizations

## Execution Snapshot

1. Phase number: 5
2. Source plan: `plugins/usage-tracker/BACKGROUND-ROLLUP-PLAN.md`
3. Readiness: `Blocked`
4. Primary deliverable: targeted background-rollup SQL improvements after the durable timer-only architecture is stable
5. Blocking dependencies: Phases 2 through 4 are not yet implemented
6. Target measurements summary: none required until the durable timer-only scheduler is working and measured
7. Next phase: final follow-through only; no further planned phase in this repo

## Why This Phase Exists

This phase exists only if the durable timer-only scheduler still leaves too much background read cost after the main architecture is correct. It is not part of the first required implementation.

## Start Criteria

1. durable timer-only scheduling is implemented
2. forced convergence and restart recovery are implemented
3. measured evidence shows background reads are still expensive enough to justify SQL work

Current evidence:

1. none of those conditions are met in the current repo state

## Dependencies And How To Check Them

1. Dependency: Phase 2 scheduling
Why it matters: SQL optimization should not happen before the main read-pressure win exists
How to verify: inspect queue code and tests for deferred rollup scheduling
Status: `Not Done`

2. Dependency: Phase 3 convergence
Why it matters: optimization should happen after maintenance semantics are stable
How to verify: inspect queue tests for deterministic `flush()` and orphan replay convergence
Status: `Not Done`

3. Dependency: Phase 4 durability
Why it matters: optimization should not happen while the durable architecture is still in doubt
How to verify: inspect queue tests for restart recovery and durable cleanup semantics
Status: `Not Done`

4. Dependency: measured evidence of remaining background cost
Why it matters: this phase is optional and should be justified by measurements
How to verify: benchmark notes, test counters, or profiling evidence after the main architecture lands
Status: `Unknown`

## Target Measurements And Gates

Entry gates:

1. Measurement: durable timer-only architecture is complete
Pass condition: Phases 2 through 4 are visibly done and tested
Measurement method: inspect repo and run tracker tests
Current evidence: not complete
Status: `Not Met`

2. Measurement: remaining background read cost is still a problem
Pass condition: there is recorded evidence showing enough remaining cost to justify SQL work
Measurement method: queue counters, profiling, or notes captured after the main architecture lands
Current evidence: not yet available
Status: `Unknown`

Exit gates:

1. Measurement: targeted optimization preserves output semantics
Pass condition: rollup outputs remain correct and tests still pass
Measurement method: queue tests, fixture-driven integration tests, and any SQL-specific checks
Current evidence: not yet applicable
Status: `Unknown`

If no justified measurement exists, this phase should not start.

## Scope

1. optimize one rollup family at a time
2. reduce unnecessary background queries
3. preserve rollup semantics exactly
4. add indexes only after query shape is understood

## Out Of Scope

1. queue scheduling semantics
2. durability model changes
3. trigger heuristics or thresholds
4. normalization changes

## Implementation Details

1. Keep the durable timer-only architecture fixed while doing SQL work.
2. Attack one rollup family at a time so regressions are attributable.
3. Prefer set-based operations over repeated read-then-delete loops where the current `rollups.js` shape permits it.
4. Preserve rollup output semantics exactly. SQL optimization is not license to redefine metrics.

## Execution Checklist

1. Confirm Phases 2 through 4 are complete and measured.
2. Identify one specific remaining hotspot in `plugins/usage-tracker/rollups.js`.
3. Optimize only that hotspot.
4. Re-run queue and fixture tests.
5. Record whether the optimization actually reduced background query cost.
6. Repeat only if another hotspot is still justified by evidence.

## Files And Systems Likely Affected

1. `plugins/usage-tracker/rollups.js`
2. `plugins/usage-tracker/schema.js` if an index is justified
3. `plugins/usage-tracker/test/queue.test.js`
4. `plugins/usage-tracker/test/queue-fixture.test.js` if present
5. measurement notes or docs if the optimization needs recorded evidence

## Verification

Run:

```bash
bun test plugins/usage-tracker/test/queue.test.js
bun test plugins/usage-tracker/test
```

Then verify:

1. optimized rollup family still produces correct output
2. background query behavior improves for the targeted hotspot
3. no queue, durability, or convergence semantics regress

## Done Criteria

1. at least one justified hotspot is optimized
2. tests still pass
3. evidence shows the optimization helped enough to keep
4. no durability or scheduler semantics changed accidentally

## Handoff To Next Phase

There is no further planned phase in this repo sequence.

Final follow-through after this phase:

1. record the final measurement outcome
2. decide whether more SQL work is still justified
3. otherwise stop and keep the architecture stable

## Open Questions Or Blockers

1. Blocker: there is no current evidence yet that background SQL optimization is needed after the durable timer-only architecture lands

## Sources

1. `plugins/usage-tracker/BACKGROUND-ROLLUP-PLAN.md`, Step 8 and SQL optimization references
2. `plugins/usage-tracker/rollups.js`
3. `plugins/usage-tracker/schema.js`
4. `plugins/usage-tracker/test/queue.test.js`
5. `plugins/usage-tracker/test` suite
