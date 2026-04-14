# Phase 0: Measurement Harness

## Execution Snapshot

1. Phase number: 0
2. Source plan: `plugins/usage-tracker/BACKGROUND-ROLLUP-PLAN.md`
3. Readiness: `Ready`
4. Primary deliverable: deterministic queue test harness and realistic SQLite fixture foundation
5. Blocking dependencies: none
6. Target measurements summary: observability only, not performance improvement yet
7. Next phase: `PHASE-1-END-STATE-TESTS.md`

## Why This Phase Exists

This phase creates the test and measurement foundation needed before runtime behavior changes. The source plan now depends on two kinds of evidence:

1. narrow queue tests for scheduling, durability, and replay behavior
2. SQLite fixture-backed tests for realistic OpenCode data shapes

Without this phase, later phases would be forced to change queue behavior and invent their proof at the same time.

## Start Criteria

1. `plugins/usage-tracker/test/queue.test.js` exists
2. `plugins/usage-tracker/test/history.test.js` exists
3. `createIngestionQueue()` in `plugins/usage-tracker/queue.js` is available for injected timers and fake dependencies
4. local tracker tests are runnable

Current evidence:

1. `bun test plugins/usage-tracker/test/queue.test.js` passes
2. `bun test plugins/usage-tracker/test` passes

## Dependencies And How To Check Them

1. Dependency: runnable tracker test suite
Why it matters: this phase is only useful if the harness can be exercised locally
How to verify: run `bun test plugins/usage-tracker/test/queue.test.js` and `bun test plugins/usage-tracker/test`
Status: `Done`

2. Dependency: existing fake timer injection points in `createIngestionQueue()`
Why it matters: later phases require deterministic scheduling tests
How to verify: inspect `plugins/usage-tracker/queue.js` for `setTimeoutFn`, `clearTimeoutFn`, and `sleepFn` options
Status: `Done`

3. Dependency: SQLite-backed tracker tests already exist
Why it matters: the fixture approach should extend an existing pattern rather than introduce a new test style from scratch
How to verify: inspect `plugins/usage-tracker/test/history.test.js`
Status: `Done`

## Target Measurements And Gates

Entry gates:

1. Measurement: queue tests run locally
Pass condition: `bun test plugins/usage-tracker/test/queue.test.js` succeeds
Measurement method: run the command
Current evidence: passing
Status: `Met`

2. Measurement: broader tracker tests run locally
Pass condition: `bun test plugins/usage-tracker/test` succeeds
Measurement method: run the command
Current evidence: passing
Status: `Met`

Exit gates:

1. Measurement: fake Turso harness exposes `writeFactsCount`, `replaceRollupsCount`, `queryCount`, and captured queries
Pass condition: counters and recorded calls are available in tests
Measurement method: inspect `plugins/usage-tracker/test/queue.test.js`
Current evidence: already present
Status: `Met`

2. Measurement: deterministic timer harness exists
Pass condition: tests can run queued callbacks without real sleeps
Measurement method: inspect `createFakeTimers()` and run queue tests
Current evidence: already present
Status: `Met`

3. Measurement: fixture foundation exists
Pass condition: committed SQLite fixture directory and helper exist, or this phase creates them
Measurement method: check for `plugins/usage-tracker/test/fixtures/`
Current evidence: not present
Status: `Not Met`

## Scope

1. keep and, if needed, refine the fake Turso harness in `plugins/usage-tracker/test/queue.test.js`
2. keep and, if needed, refine deterministic timer helpers for queue tests
3. add committed SQLite fixture files under `plugins/usage-tracker/test/fixtures/`
4. add a small fixture helper if tests need a shared way to locate or copy fixture DBs
5. extract or keep reusable representative event helpers for synthetic queue tests

## Out Of Scope

1. changing runtime rollup timing semantics
2. changing queue durability behavior
3. changing rollup SQL
4. changing normalization behavior
5. adding trigger heuristics or thresholds

## Implementation Details

1. The fake Turso client in `plugins/usage-tracker/test/queue.test.js` already tracks `ensureSchemaCount`, `writeFactsCount`, `replaceRollupsCount`, `queryCount`, `queries`, and `replaceRollupsPayloads`. Preserve those counters as the baseline queue harness.
2. The timer harness already exposes `runNextTimer()` and `runAllTimers()`. Preserve that deterministic structure so later phases do not introduce wall-clock waiting.
3. Add a committed SQLite fixture directory using the OpenCode table shape that `history.js` already expects: `session`, `message`, and `part`.
4. Keep fixture files small and sanitized. The goal is realistic shape, not a full private database snapshot.
5. Reuse the existing representative event helper pattern in `queue.test.js` for narrow scheduler tests. Do not replace every queue test with fixture-driven tests.

## Execution Checklist

1. Verify current queue and tracker tests pass locally.
2. Keep the fake Turso harness stable and confirm it records the counters needed by later phases.
3. Keep the fake timer harness stable and confirm queued timers can be drained deterministically.
4. Add `plugins/usage-tracker/test/fixtures/`.
5. Add the smallest shared fixture helper needed by later phases.
6. Create committed SQLite fixtures for simple turn, tool-heavy turn, lineage, and historical hydration scenarios.
7. Confirm the fixture files can be opened and consumed from tests without reading a developer-specific DB path.

## Files And Systems Likely Affected

1. `plugins/usage-tracker/test/queue.test.js`
2. `plugins/usage-tracker/test/history.test.js`
3. `plugins/usage-tracker/test/fixtures/`
4. `plugins/usage-tracker/test/fixture-db.js` if added
5. `plugins/usage-tracker/queue.js` only if a tiny harness-oriented injection cleanup is needed
6. `plugins/usage-tracker/index.d.ts` only if test injection types need documenting

## Verification

Run:

```bash
bun test plugins/usage-tracker/test/queue.test.js
bun test plugins/usage-tracker/test/history.test.js
bun test plugins/usage-tracker/test
```

Then verify:

1. fake Turso counters are still observable in queue tests
2. queue tests still use deterministic timers rather than real waiting
3. committed SQLite fixtures exist and are readable from tests
4. no runtime behavior changed yet

## Done Criteria

1. queue tests remain deterministic
2. fake Turso counters remain visible and usable by later phases
3. committed SQLite fixtures exist under `plugins/usage-tracker/test/fixtures/`
4. fixture access does not depend on `~/.local/share/opencode/opencode.db`
5. tracker tests still pass

## Handoff To Next Phase

Next phase: `PHASE-1-END-STATE-TESTS.md`

This phase must deliver:

1. stable fake Turso counters
2. stable fake timer helpers
3. committed SQLite fixtures
4. reusable test setup for representative event shapes

What becomes unblocked:

1. Phase 1 can define the end-state contract using both narrow queue tests and realistic fixture-backed integration tests.

## Open Questions Or Blockers

1. Unknown: whether the fixture helper should copy DB files to a temp path before mutation or keep every fixture strictly read-only in tests

## Sources

1. `plugins/usage-tracker/BACKGROUND-ROLLUP-PLAN.md`, Step 1 and Step 2
2. `plugins/usage-tracker/test/queue.test.js`
3. `plugins/usage-tracker/test/history.test.js`
4. `plugins/usage-tracker/queue.js`
5. Local verification commands:
6. `bun test plugins/usage-tracker/test/queue.test.js`
7. `bun test plugins/usage-tracker/test`
