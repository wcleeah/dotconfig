# Phase 5: SQL Optimizations

## Quick Check

1. Dependency status: Phase 4 should be complete, or the team should have explicitly decided to defer Phase 4B durability work.
2. Can an agent start now: only if the timer-based design is already stable and measured.
3. Main outcome: background rollup recomputation uses fewer or cheaper reads without changing the external consistency model.

## What This Phase Is About

This phase is an optimization pass on the deferred-rollup system.

It does not introduce the main architectural win. That already happened in earlier phases by moving rollups off the hot fact-write path.

This phase exists for the case where background rollup work is still too expensive after the timer-based design lands.

The focus is:

1. fewer total background queries per rollup pass
2. better index usage inside existing rollup queries
3. less repeated work across related rollup families
4. keeping rollup correctness unchanged

## Scope

In scope:

1. `plugins/usage-tracker/rollups.js`
2. `plugins/usage-tracker/schema.js` if indexes need to change
3. `plugins/usage-tracker/test/queue.test.js` for query-count or behavior assertions
4. new rollup-focused tests if needed

Out of scope:

1. changing the consistency model back to immediate rollups
2. redesigning normalization semantics
3. broad schema redesign unrelated to rollup efficiency
4. undoing the timer-based architecture from Phase 2

## Dependencies

Required completed work:

1. `PHASE-2-BACKGROUND-ROLLUP-SCHEDULING.md`
2. `PHASE-3-FORCED-FLUSH-CONVERGENCE.md`

Strongly recommended completed work:

1. `PHASE-4-FAILURE-AND-DURABILITY.md`

Required state before starting:

1. hot-path reads are already zero before the timer fires
2. timer-driven rollups already work correctly
3. `queue.flush()` already forces convergence
4. there is measurement evidence that background rollups are still expensive enough to justify SQL work

## Can Start When

An agent can start this phase when all of these are true:

1. the primary architectural win is already landed
2. the current background rollup cost has been measured with the Phase 0 harness or equivalent instrumentation
3. the optimization goal is clear: fewer queries, faster rollup passes, or both
4. there is no unresolved correctness bug in the deferred-rollup path that would make optimization premature

## Do Not Start Yet If

1. Phase 2 is not complete
2. `queue.flush()` still has correctness gaps
3. retry or durability behavior is still being actively redesigned
4. there is no actual measurement showing background rollups are still a problem

## Stop And Investigate If

1. an optimization reduces queries but changes rollup results
2. query count goes down but total rollup latency does not improve because queries became much heavier
3. index changes cause write-side regressions or schema churn bigger than the measured benefit
4. the optimization starts expanding into a schema redesign rather than a focused performance pass

## Target Measurements

This phase should not start without a baseline.

Capture baseline measurements for one representative background rollup pass and one burst case.

Required baseline measurements:

1. `background_query_count_per_rollup_pass`
2. `rollup_pass_count_per_burst`
3. `rollup_execution_time_ms` if measurable in tests or local profiling
4. which rollup families dominate query volume

Recommended success targets:

1. fewer background queries for the same touched-key workload
2. lower rollup execution time for the same touched-key workload
3. no change in rollup correctness
4. no regression in fact-write behavior

Because the exact baseline may vary by fixture, prefer percentage or directional targets in notes, and concrete assertions only where stable.

Good committed targets:

1. one optimization removes entire classes of redundant queries
2. a single rollup family now uses one set-based query instead of per-key point queries
3. daily range predicates are used instead of wrapping indexed columns in `date(...)`

Bad committed targets:

1. fragile exact micro-benchmark thresholds in unit tests
2. exact global query counts if the fixture changes frequently

## Likely Hotspots To Attack

Based on the current implementation, the main candidates are:

1. per-key loops in `recomputeSessionRollups()`
2. per-key loops in `recomputeSessionModelRollups()`
3. per-key loops in `recomputeProjectRollups()`
4. per-key loops in `recomputeProjectModelRollups()`
5. extra existence or count reads in `recomputeDailyProjectRollups()`
6. daily filters using `date(...)` and `COALESCE(...)` over indexed timestamp columns

## Files Likely To Change

Primary files:

1. `plugins/usage-tracker/rollups.js`
2. `plugins/usage-tracker/schema.js`

Supporting files:

1. `plugins/usage-tracker/test/queue.test.js`
2. `plugins/usage-tracker/test/schema.test.js`
3. a new rollup-focused test file if targeted coverage becomes too awkward in queue tests

Try to avoid touching these unless absolutely necessary:

1. `plugins/usage-tracker/normalize.js`
2. `plugins/usage-tracker/history.js`
3. `plugins/usage-tracker/outbox.js`

## Implementation Strategy

### 1. Optimize One Rollup Family At A Time

Do not attempt a giant rewrite of all rollup SQL in one change.

Recommended order:

1. remove obviously redundant existence reads or count reads
2. batch per-key reads into set-based queries where practical
3. rewrite daily predicates to use timestamp ranges
4. add or adjust indexes only after query shape is settled

This keeps each optimization measurable and reversible.

### 2. Prefer Set-Based Deletes Over Read-Then-Delete Patterns

Some rollup families currently read existing keys just to know what to delete.

Prefer patterns like:

1. `DELETE FROM session_model_rollups WHERE session_id IN (...)`
2. `DELETE FROM project_model_rollups WHERE project_id IN (...)`

when that is semantically equivalent.

This removes an entire read class rather than just making it faster.

### 3. Rewrite Daily Predicates To Use Timestamp Ranges

Avoid wrapping indexed timestamp columns with `date(...)` where possible.

Prefer range predicates such as:

1. `time_created >= dayStartMs AND time_created < dayEndMs`
2. `started_at >= dayStartMs AND started_at < dayEndMs`

This usually gives indexes a much better chance to help.

If a query uses `COALESCE(started_at, time_updated)` today, consider whether the data model or query logic can be reshaped into a range-friendly predicate without changing semantics.

### 4. Remove Duplicate Reads Inside The Same Rollup Family

For example, if one family runs a main aggregate query and then separate follow-up existence counts, first check whether the main query can already tell you whether the row should exist.

This is especially relevant to daily project rollups, where the current implementation performs multiple reads for one key.

### 5. Add Indexes Only After Query Shape Is Chosen

Avoid adding indexes before the query rewrite is clear.

When adding indexes:

1. document which query they are for
2. keep them narrowly targeted
3. verify they do not create obvious write amplification with little read benefit

### 6. Preserve Output Semantics Exactly

For every optimization, the rollup rows produced must remain semantically equivalent.

That includes:

1. delete behavior when a rollup should disappear
2. null versus zero behavior in aggregate fields
3. last-activity calculations
4. distinct-model counts
5. tool-day and project-day behavior

## Verification

Run the relevant targeted tests first:

```bash
bun test plugins/usage-tracker/test/queue.test.js
```

If schema or rollup tests change, also run:

```bash
bun test plugins/usage-tracker/test
```

For each optimization, verify all of these:

1. rollup correctness still holds for the representative event sequence
2. query-count instrumentation shows improvement for the targeted workload
3. burst coalescing behavior from earlier phases still works
4. explicit `queue.flush()` semantics still work unchanged

## Exit Criteria

This phase is complete when all of these are true:

1. at least one measured background rollup hotspot is materially improved
2. the improvement is backed by before-and-after measurement
3. rollup correctness is unchanged
4. earlier timer and flush semantics still pass unchanged
5. the optimization remains focused and does not sprawl into an unrelated redesign

## What Comes Next

There is no required next phase after this one.

Possible follow-up work, if still justified by measurement:

1. additional rollup-family batching
2. more targeted indexes
3. a dedicated rollup benchmark harness if SQL tuning becomes ongoing work

If measurement no longer shows a problem after the first optimization pass, stop here.
