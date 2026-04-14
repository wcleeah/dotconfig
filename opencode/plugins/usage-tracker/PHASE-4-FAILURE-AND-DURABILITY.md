# Phase 4: Failure And Durability

## Execution Snapshot

1. Phase number: 4
2. Source plan: `plugins/usage-tracker/BACKGROUND-ROLLUP-PLAN.md`
3. Readiness: `Blocked`
4. Primary deliverable: failure hardening, durable cleanup correctness, and replay-tooling alignment for the durable journal architecture
5. Blocking dependencies: Phases 2 and 3 are not yet implemented
6. Target measurements summary: pending rollup work survives restart; deterministic replay works; durable journal entries are removed only after rollup success
7. Next phase: `PHASE-5-SQL-OPTIMIZATIONS.md`

## Why This Phase Exists

The source plan no longer treats durability as optional. This phase hardens the already-introduced durable-journal design so fact failures, rollup failures, cleanup rules, and operator replay tooling all match the new architecture.

## Start Criteria

1. background rollup scheduling exists
2. startup recovery and forced convergence semantics exist
3. the durable journal is the mainline source of truth for flushed batches

Current evidence:

1. none of those deliverables are visible in the repo yet

## Dependencies And How To Check Them

1. Dependency: Phase 2 durable scheduler
Why it matters: failure semantics only matter once journal-backed scheduling exists
How to verify: inspect `plugins/usage-tracker/queue.js` and storage code for mainline durable journal writes, timer-driven `flushRollups()`, and no inline rollup recomputation in `flushBatch()`
Status: `Not Done`

2. Dependency: Phase 3 startup recovery and convergence semantics
Why it matters: this phase should harden failure behavior on top of known startup, `flush()`, and orphan replay ordering
How to verify: inspect queue tests for deterministic startup recovery, `flush()`, and orphan replay behavior
Status: `Not Done`

## Target Measurements And Gates

Entry gates:

1. Measurement: durable journal model exists and startup recovery is already present
Pass condition: flushed batches persist before remote fact writes, and startup recovery is implemented
Measurement method: inspect code and queue tests
Current evidence: not yet present
Status: `Not Met`

Exit gates:

1. Measurement: restart recovery
Pass condition: pending durable work survives simulated restart and converges later
Measurement method: queue tests
Current evidence: not yet implemented
Status: `Not Met`

2. Measurement: deterministic replay
Pass condition: ordered replay is explicit and tested
Measurement method: queue tests
Current evidence: not yet implemented
Status: `Not Met`

3. Measurement: durable cleanup correctness
Pass condition: durable journal entries are removed only after successful rollup replacement
Measurement method: queue tests
Current evidence: not yet implemented
Status: `Not Met`

## Scope

1. failure handling for fact writes under the durable model
2. failure handling for rollup writes under the durable model
3. durable cleanup after rollup success
4. replay-tooling alignment if the old failure-only outbox assumptions are no longer valid
5. final hardening of deterministic replay where failures interact with restart recovery

## Out Of Scope

1. introducing the durable journal for the first time
2. defining startup recovery order from scratch
3. SQL optimization in `rollups.js`
4. schema redesign beyond what the journal metadata itself needs
5. trigger heuristics or thresholds

## Implementation Details

1. The old Phase 4A versus Phase 4B split is no longer valid under the current plan. Durable pending rollup work is required in the mainline design.
2. Journal replay order must already be explicit before this phase starts. This phase should verify and harden it under failure paths rather than invent it here.
3. The cleanup rule should already exist before this phase starts: journal entries survive until rollups succeed.
4. This phase should harden that rule under failure paths rather than introduce it for the first time.
5. Rollup failure must leave durable work pending.
6. Fact write failure must also leave durable work pending for replay under the new mainline journal model.
7. Replay tooling such as `opencode-stats-sync-script/src/commands/replay-outbox.ts` may need updates if it assumes a failure-only outbox layout.

## Execution Checklist

1. Ensure fact write failure keeps durable work pending.
2. Ensure rollup failure keeps durable work pending.
3. Ensure rollup success removes the covered durable work and that failure paths never clean it up early.
4. Add restart-and-failure simulation tests where ordered replay and recovery interact.
5. Review replay tooling for compatibility with the new storage model.
6. Update operator-facing replay docs if the storage model or command meaning changed.

## Files And Systems Likely Affected

1. `plugins/usage-tracker/queue.js`
2. `plugins/usage-tracker/outbox.js` or a renamed/reworked storage helper
3. `plugins/usage-tracker/index.d.ts`
4. `plugins/usage-tracker/test/queue.test.js`
5. `opencode-stats-sync-script/src/commands/replay-outbox.ts`
6. `opencode-stats-sync-script/README.md` if operator commands need updating

## Verification

Run:

```bash
bun test plugins/usage-tracker/test/queue.test.js
bun test plugins/usage-tracker/test
```

Then verify:

1. fact write failure leaves durable work pending
2. rollup failure leaves durable work pending
3. successful rollup completion removes durable work
4. restart-plus-failure scenarios still replay in explicit deterministic order
5. replay tooling still matches the storage model or has been updated accordingly

## Done Criteria

1. fact write failure semantics are correct and tested
2. rollup failure semantics are correct and tested
3. cleanup after rollup success is correct and tested
4. replay tooling is either still valid or updated
5. tracker tests pass

## Handoff To Next Phase

Next phase: `PHASE-5-SQL-OPTIMIZATIONS.md`

This phase must deliver:

1. trustworthy fact and rollup failure semantics
2. trustworthy durable cleanup semantics
3. trustworthy replay-tooling alignment

What becomes unblocked:

1. Phase 5 can optimize background rollup SQL without still questioning whether the durable timer-only architecture is correct under failure.

## Open Questions Or Blockers

1. Unknown: whether operator replay tooling should keep the `replay-outbox` command name after the storage model stops being failure-only

## Sources

1. `plugins/usage-tracker/BACKGROUND-ROLLUP-PLAN.md`, Step 3 through Step 6, risks, verification, and rollback
2. `plugins/usage-tracker/outbox.js`
3. `plugins/usage-tracker/queue.js`
4. `plugins/usage-tracker/index.d.ts`
5. `opencode-stats-sync-script/src/commands/replay-outbox.ts`
6. `opencode-stats-sync-script/README.md`
