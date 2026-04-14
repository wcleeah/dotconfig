# Phase 3: Forced Flush Convergence

## Execution Snapshot

1. Phase number: 3
2. Source plan: `plugins/usage-tracker/BACKGROUND-ROLLUP-PLAN.md`
3. Readiness: `Completed`
4. Primary deliverable: deterministic startup recovery, `flush()`, and orphan replay convergence on top of durable timer-only scheduling
5. Blocking dependencies: none
6. Target measurements summary: `queue.flush()` drains journal-backed fact work and journal-backed rollup work before returning
7. Next phase: `PHASE-4-FAILURE-AND-DURABILITY.md`

## Why This Phase Exists

Normal runtime is allowed to be eventually consistent. Maintenance paths and restart recovery are not. This phase defines the exact convergence behavior for startup recovery, `queue.flush()`, and orphan replay once durable timer-only scheduling exists.

## Start Criteria

1. Phase 2 timer-only scheduling is implemented
2. background rollup tests are passing
3. durable journal entries exist as the source of truth for pending work

Current evidence:

1. Phase 2 timer-only scheduling is implemented and tested
2. `queue.flush()` already forces journal-backed fact and rollup convergence
3. startup recovery now scans surviving durable journal files and resumes convergence automatically
4. orphan replay remains deterministic and convergent

## Dependencies And How To Check Them

1. Dependency: Phase 2 background scheduling and durable journal introduction
Why it matters: there is nothing to force-converge until rollup work is actually deferred and journal-backed
How to verify: inspect `plugins/usage-tracker/queue.js` for `rollupDelayMs`, timer-based `flushRollups()`, no inline rollup recomputation in `flushBatch()`, and durable journal writes before remote fact writes
Status: `Done`

## Target Measurements And Gates

Entry gates:

1. Measurement: durable timer-only scheduling exists
Pass condition: deferred rollup scheduler and mainline durable journal are implemented and tested
Measurement method: inspect code and run queue tests
Current evidence: implemented in `plugins/usage-tracker/queue.js` and covered by `plugins/usage-tracker/test/queue.test.js`
Status: `Met`

Exit gates:

1. Measurement: forced convergence
Pass condition: `queue.flush()` returns only after journal-backed fact and rollup work are complete for already-known work
Measurement method: queue tests
Current evidence: implemented and covered by `queue.test.js`
Status: `Met`

2. Measurement: startup recovery
Pass condition: startup or initialization scans the durable journal and rebuilds the working state needed for later convergence
Measurement method: queue tests and code inspection
Current evidence: implemented and covered by `queue.test.js`
Status: `Met`

3. Measurement: orphan replay convergence
Pass condition: orphan replay returns only after facts and rollups are converged
Measurement method: queue tests and replay-focused tests
Current evidence: implemented and covered by `queue.test.js`
Status: `Met`

## Scope

1. define startup recovery behavior from the durable journal
2. define exact `flush()` order
3. define exact orphan replay order and convergence rule
4. clean up timer state and in-flight coordination
5. ensure maintenance boundaries remain deterministic

## Out Of Scope

1. changing SQL in `rollups.js`
2. changing normalization semantics
3. deeper failure hardening and replay-tooling updates beyond convergence semantics
4. adding trigger heuristics or thresholds

## Implementation Details

1. Startup or initialization must scan the durable journal and rebuild any in-memory working state needed for fact and rollup processing.
2. `flush()` must first materialize any pending in-memory fact batch into the durable journal.
3. `flush()` must then process durable journal entries in deterministic order until facts are applied.
4. `flush()` must cancel or join the rollup timer path and continue until the durable journal is empty for already-known work.
5. `replayAllOutbox()` or its successor must preserve deterministic full-convergence semantics rather than stopping after facts are written.
6. This phase should use the existing cleanup rule from Phase 2: durable journal entries are removed only after successful rollup completion for the covered work.
7. Timer and `flush()` coordination should use one shared in-flight mechanism so they do not race each other and lose dirty keys.

## Execution Checklist

1. Define and document startup recovery ordering in code.
2. Define and document exact `flush()` ordering in code.
3. Ensure pending in-memory work is journaled before forced processing starts.
4. Ensure durable journal facts are processed before forced rollup convergence begins.
5. Ensure `flush()` joins or runs the rollup worker until journal-backed work is done.
6. Ensure orphan replay forces full convergence before returning.
7. Add deterministic queue tests for startup recovery, re-entrancy, and timer/flush overlap.
8. Verify forced convergence paths respect the existing cleanup-on-rollup-success rule.

## Files And Systems Likely Affected

1. `plugins/usage-tracker/queue.js`
2. `plugins/usage-tracker/index.js`
3. `plugins/usage-tracker/test/queue.test.js`
4. replay tooling only if startup or orphan recovery semantics already require a small interface adjustment

## Verification

Run:

```bash
bun test plugins/usage-tracker/test/queue.test.js
bun test plugins/usage-tracker/test
```

Then verify:

1. startup recovery rebuilds working state from the durable journal
2. `queue.flush()` drains already-known durable fact and rollup work
3. timer state is cleaned up correctly after forced convergence
4. orphan replay converges before returning
5. timer and `flush()` overlap does not lose work

## Done Criteria

1. startup recovery has one explicit deterministic order
2. `queue.flush()` has one explicit deterministic order
3. queue tests prove forced convergence
4. queue tests prove orphan replay convergence
5. tracker tests pass

## Handoff To Next Phase

Next phase: `PHASE-4-FAILURE-AND-DURABILITY.md`

This phase must deliver:

1. deterministic startup recovery
2. deterministic forced convergence
3. deterministic orphan replay semantics
4. confirmed convergence behavior that respects cleanup-on-rollup-success

What becomes unblocked:

1. Phase 4 can focus on failure semantics and replay-tooling alignment instead of still debating startup, flush, or basic cleanup behavior.

## Open Questions Or Blockers

1. Remaining work moves to Phase 4: failure hardening, cleanup correctness under failure, and replay-tooling alignment

## Sources

1. `plugins/usage-tracker/BACKGROUND-ROLLUP-PLAN.md`, Step 6
2. `plugins/usage-tracker/queue.js`
3. `plugins/usage-tracker/index.js`
4. `plugins/usage-tracker/test/queue.test.js`
