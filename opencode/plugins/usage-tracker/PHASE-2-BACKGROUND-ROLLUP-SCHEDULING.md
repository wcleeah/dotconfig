# Phase 2: Background Rollup Scheduling

## Execution Snapshot

1. Phase number: 2
2. Source plan: `plugins/usage-tracker/BACKGROUND-ROLLUP-PLAN.md`
3. Readiness: `Completed`
4. Primary deliverable: mainline durable journal plus timer-only background rollup scheduling
5. Blocking dependencies: none
6. Target measurements summary: durable batches persist before remote writes; hot-path `queryCount === 0` before the rollup timer; no fast paths or thresholds introduced
7. Next phase: `PHASE-3-FORCED-FLUSH-CONVERGENCE.md`

## Why This Phase Exists

This phase is the first runtime refactor phase. It replaces the failure-only outbox model with a mainline durable journal and then removes inline rollup recomputation from the hot write path while preserving the timer-only policy chosen in the source plan.

It establishes the mainline durable queue and timer behavior, including the core cleanup rule that journal entries remain until the covered rollup work succeeds. Later phases harden restart, flush, and failure behavior around that rule.

## Start Criteria

1. Phase 1 end-state tests exist and pass
2. the durable journal model is accepted as the source of truth
3. no trigger-heuristic work is in flight

Current evidence:

1. durable journal design is documented in the plan
2. Phase 1 end-state tests and fixture-driven integration coverage are now present in the repo

## Dependencies And How To Check Them

1. Dependency: Phase 1 end-state tests
Why it matters: scheduling should be implemented against a fixed semantic contract
How to verify: inspect `plugins/usage-tracker/test/queue.test.js` and any fixture-driven integration file for durable timer-only assertions
Status: `Done`

2. Dependency: timer-only policy decision
Why it matters: this phase must not re-open fast-path or threshold design
How to verify: inspect `plugins/usage-tracker/BACKGROUND-ROLLUP-PLAN.md`
Status: `Done`

3. Dependency: durable journal design decision
Why it matters: this phase itself must introduce the journal; the design decision needs to be settled before coding starts
How to verify: inspect `plugins/usage-tracker/BACKGROUND-ROLLUP-PLAN.md`
Status: `Done`

## Target Measurements And Gates

Entry gates:

1. Measurement: end-state scheduling tests exist
Pass condition: tests for durable persistence, zero hot-path rollup reads, and later convergence exist
Measurement method: inspect test files and run them
Current evidence: `queue.test.js` now covers durable persistence, deterministic replay, zero hot-path rollup reads before the rollup timer, failure retention, flush draining, and orphan replay convergence; `queue-fixture.test.js` provides realistic fixture-driven coverage
Status: `Met`

Exit gates:

1. Measurement: durable persistence before remote fact write
Pass condition: queue tests prove a flushed batch is persisted before remote fact write begins
Measurement method: queue tests
Current evidence: implemented and covered by `queue.test.js`
Status: `Met`

2. Measurement: hot-path rollup reads before rollup timer
Pass condition: `queryCount === 0` before rollup timer execution
Measurement method: queue tests and fixture-driven integration tests
Current evidence: implemented and covered by `queue.test.js`
Status: `Met`

3. Measurement: background rollup execution after timer
Pass condition: later timer execution triggers `recomputeTouchedRollups()` and `replaceRollups()`
Measurement method: queue tests
Current evidence: implemented and covered by `queue.test.js`
Status: `Met`

Target measurements for this phase: none beyond the semantic scheduler contract above.

## Scope

1. replace the failure-only outbox with a mainline durable journal
2. add explicit replay-order metadata
3. add `rollupDelayMs`
4. remove inline rollup recomputation from the fact write path
5. add timer-based rollup scheduling
6. preserve timer-only policy with no fast paths
7. remove durable journal entries only after confirmed rollup success for the covered work

## Out Of Scope

1. final `flush()` convergence semantics
2. final orphan replay semantics
3. full failure hardening and replay-tooling alignment
4. SQL optimization
5. trigger heuristics or thresholds

## Implementation Details

1. `plugins/usage-tracker/outbox.js` or its successor should stop being a failure-only store and become the durable journal for all flushed `QueueBatch` records.
2. Add explicit replay-order metadata such as a per-process monotonic sequence number. Do not treat `mtime` as the correctness mechanism.
3. `plugins/usage-tracker/queue.js` should stop calling `recomputeTouchedRollups()` directly from `flushBatch()`.
4. Introduce `rollupDelayMs` and rollup timer state.
5. When the fact timer materializes a batch, persist it durably before remote fact write begins.
6. After a durable journal entry's facts are successfully written, merge its `touched` keys into an in-memory rollup working set.
7. Schedule `flushRollups()` later on the rollup timer.
8. Delete durable journal entries only after confirmed rollup success for the covered work. Do not introduce any earlier cleanup point.
9. Do not add event-specific or fact-count-based early rollup triggers.

## Execution Checklist

1. Convert the storage layer from failure-only outbox to mainline durable journal.
2. Add explicit replay-order metadata to durable journal entries.
3. Add `rollupDelayMs` to the queue interface.
4. Remove inline `recomputeTouchedRollups()` from the fact write path.
5. Add rollup timer state and scheduling helpers.
6. Merge post-fact-write touched keys into an in-memory rollup working set.
7. Remove durable journal entries only after `flushRollups()` completes successfully for the covered work.
8. Trigger `flushRollups()` only from timer or explicit convergence paths.
9. Preserve deterministic tests while changing the scheduler and storage model.

## Files And Systems Likely Affected

1. `plugins/usage-tracker/queue.js`
2. `plugins/usage-tracker/outbox.js` or a renamed successor such as `journal.js`
3. `plugins/usage-tracker/index.d.ts`
4. `plugins/usage-tracker/test/queue.test.js`
5. `plugins/usage-tracker/test/queue-fixture.test.js` if present

## Verification

Run:

```bash
bun test plugins/usage-tracker/test/queue.test.js
bun test plugins/usage-tracker/test
```

Then verify:

1. a flushed batch is persisted durably before remote fact write begins
2. inline rollup reads are gone from the hot path
3. `queryCount === 0` before rollup timer execution
4. background timer later triggers rollup reads and replacement
5. no fast-path or threshold behavior was introduced

## Done Criteria

1. a mainline durable journal exists for flushed batches
2. explicit replay-order metadata exists for durable journal entries
3. inline rollup recomputation is removed from the fact write path
4. rollups are scheduled by a second timer
5. durable journal entries are removed only after successful rollup completion
6. hot-path queue tests prove zero rollup reads before that timer fires
7. tracker tests pass

## Handoff To Next Phase

Next phase: `PHASE-3-FORCED-FLUSH-CONVERGENCE.md`

This phase must deliver:

1. mainline durable journal for flushed batches
2. timer-only background scheduling
3. cleanup tied to rollup success
4. preserved fact-write behavior
5. passing scheduler tests

What becomes unblocked:

1. Phase 3 can define startup recovery, exact `flush()` order, and orphan replay convergence semantics on top of the new durable scheduler.

## Open Questions Or Blockers

1. Remaining work moves to Phase 3: startup recovery, exact `flush()` order hardening, and orphan replay semantics beyond the current Phase 2 contract

## Sources

1. `plugins/usage-tracker/BACKGROUND-ROLLUP-PLAN.md`, Step 3 through Step 5
2. `plugins/usage-tracker/queue.js`
3. `plugins/usage-tracker/outbox.js`
4. `plugins/usage-tracker/index.d.ts`
5. `plugins/usage-tracker/test/queue.test.js`
