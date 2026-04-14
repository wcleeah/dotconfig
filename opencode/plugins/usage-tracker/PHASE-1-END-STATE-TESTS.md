# Phase 1: End-State Tests

## Execution Snapshot

1. Phase number: 1
2. Source plan: `plugins/usage-tracker/BACKGROUND-ROLLUP-PLAN.md`
3. Readiness: `In Progress`
4. Primary deliverable: end-state test contract for durable timer-only scheduling
5. Blocking dependencies: none for Phase 1 test authoring; runtime semantics remain blocked on later queue changes
6. Target measurements summary: zero rollup reads before the rollup timer; explicit deterministic replay and durable recovery assertions
7. Next phase: `PHASE-2-BACKGROUND-ROLLUP-SCHEDULING.md`

## Why This Phase Exists

This phase defines what the future implementation must prove before the queue refactor lands. It is where the repo stops testing only the current inline path and starts asserting the desired durable timer-only behavior.

## Start Criteria

1. fake Turso counters and fake timers exist and are stable
2. committed SQLite fixtures exist
3. tracker tests are passing before the behavior change starts

Current evidence:

1. fake Turso counters exist in `plugins/usage-tracker/test/queue.test.js`
2. fake timers exist in `plugins/usage-tracker/test/queue.test.js`
3. tracker tests pass
4. committed SQLite fixtures now exist under `plugins/usage-tracker/test/fixtures/`
5. fixture helper now exists at `plugins/usage-tracker/test/fixture-db.js`

## Dependencies And How To Check Them

1. Dependency: Phase 0 fixture foundation
Why it matters: this phase must add realistic fixture-driven assertions, not only synthetic queue tests
How to verify: check for `plugins/usage-tracker/test/fixtures/` and any helper file referenced by tests
Status: `Done`

2. Dependency: deterministic queue harness
Why it matters: end-state assertions must not rely on real time
How to verify: inspect `createFakeTimers()` in `plugins/usage-tracker/test/queue.test.js`
Status: `Done`

3. Dependency: fake Turso counters and failure injection
Why it matters: this phase needs queue-level assertions for fact writes, rollup queries, rollup replacement, and failure recovery
How to verify: inspect `createFakeTurso()` in `plugins/usage-tracker/test/queue.test.js`
Status: `Done`

## Target Measurements And Gates

Entry gates:

1. Measurement: fixture foundation exists
Pass condition: committed SQLite fixtures are present
Measurement method: check `plugins/usage-tracker/test/fixtures/`
Current evidence: `simple-turn.sqlite`, `tool-heavy.sqlite`, `lineage.sqlite`, and `historical-tool-day.sqlite` are present
Status: `Met`

Exit gates:

1. Measurement: zero rollup reads before rollup timer
Pass condition: tests assert `queryCount === 0` before rollup timer execution
Measurement method: queue tests and fixture-driven integration tests
Current evidence: current baseline still shows `queryCount > 0`
Status: `Not Met`

2. Measurement: deterministic replay coverage
Pass condition: tests assert explicit ordered replay after simulated restart
Measurement method: queue tests with durable journal fixtures or fake journal state
Current evidence: no such tests yet
Status: `Not Met`

3. Measurement: durable recovery coverage
Pass condition: tests prove pending durable work survives restart and converges later
Measurement method: queue tests and fixture-driven integration tests
Current evidence: no such tests yet
Status: `Not Met`

## Scope

1. define small queue tests for durable timer-only behavior
2. define fixture-driven integration tests for realistic conversation shapes
3. preserve the existing small normalization edge-case tests
4. assert semantics rather than current bad baseline numbers

## Out Of Scope

1. implementing durable journal runtime behavior
2. implementing background rollup scheduling
3. changing `queue.flush()` semantics
4. changing SQL in `rollups.js`

## Implementation Details

1. `plugins/usage-tracker/test/queue.test.js` should stay narrow. It should cover persistence before remote writes, deterministic replay ordering, timer boundaries, failure retention, and flush/orphan convergence.
2. Add a fixture-driven integration file such as `plugins/usage-tracker/test/queue-fixture.test.js` for realistic conversation flows.
3. Reuse committed SQLite fixtures from Phase 0 instead of writing long hand-built event sequences for every realistic case.
4. Do not lock the suite to exact global query counts for each fixture. The durable timer-only contract is about the boundary before and after the rollup timer, not about an exact number of later background queries.

## Execution Checklist

1. Add or update queue tests for durable persistence before remote fact writes.
2. Add or update queue tests for deterministic replay after restart.
3. Add or update queue tests proving zero rollup reads before the rollup timer fires.
4. Add or update queue tests proving rollup failure leaves durable work pending.
5. Add or update queue tests proving `flush()` drains durable fact and rollup work.
6. Add or update queue tests proving orphan replay converges before returning.
7. Add fixture-driven integration tests for simple turn, tool-heavy, lineage, and historical hydration fixtures.
8. Remove or demote assertions that permanently encode the old bad inline-rollup baseline.

## Files And Systems Likely Affected

1. `plugins/usage-tracker/test/queue.test.js`
2. `plugins/usage-tracker/test/history.test.js`
3. `plugins/usage-tracker/test/normalize.test.js`
4. `plugins/usage-tracker/test/queue-fixture.test.js` if added
5. `plugins/usage-tracker/test/fixtures/`

## Verification

Run:

```bash
bun test plugins/usage-tracker/test/queue.test.js
bun test plugins/usage-tracker/test/history.test.js
bun test plugins/usage-tracker/test/normalize.test.js
bun test plugins/usage-tracker/test
```

Then verify:

1. queue tests assert the desired future semantics, not the old bad baseline
2. fixture-driven tests use committed SQLite inputs
3. restart recovery and deterministic replay are covered explicitly
4. no existing small normalization tests become broad integration tests accidentally

## Done Criteria

1. end-state queue tests exist for timer-only durable behavior
2. fixture-driven integration tests exist for the main realistic conversation shapes
3. deterministic replay is part of the test contract
4. durable pending rollup recovery is part of the test contract
5. tracker tests pass

## Handoff To Next Phase

Next phase: `PHASE-2-BACKGROUND-ROLLUP-SCHEDULING.md`

This phase must deliver:

1. stable tests that describe the desired durable timer-only behavior
2. realistic fixture-backed integration coverage

What becomes unblocked:

1. Phase 2 can change queue scheduling with a clear semantic contract already in place.

## Open Questions Or Blockers

1. Remaining work: durable timer-only queue semantics are not implemented yet, so the end-state queue contract is represented by pending specs until Phase 2 lands

## Sources

1. `plugins/usage-tracker/BACKGROUND-ROLLUP-PLAN.md`, Step 1 and Step 2
2. `plugins/usage-tracker/test/queue.test.js`
3. `plugins/usage-tracker/test/history.test.js`
4. `plugins/usage-tracker/test/normalize.test.js`
5. `plugins/usage-tracker/test/fixtures/` expected path from the source plan
6. `plugins/usage-tracker/test/fixture-db.js`
7. `plugins/usage-tracker/test/queue-fixture.test.js`
8. Local verification command: `bun test plugins/usage-tracker/test`
