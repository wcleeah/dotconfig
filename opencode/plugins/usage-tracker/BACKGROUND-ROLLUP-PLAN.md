# Usage Tracker Background Rollup Plan

## Goal

Question: what end state are we trying to reach?

Short answer: move rollup work off the user-visible write path, keep the runtime policy timer-only in v1, and make pending rollup work durable through a single ordered journal instead of relying on in-memory invalidations.

In this plan:

1. a rollup is a precomputed summary table such as `project_rollups` or `daily_project_rollups`
2. eventual consistency means fact tables and rollup tables may disagree briefly, then converge automatically later
3. a golden fixture means a committed, sanitized SQLite file checked into the repo and used as a stable test input
4. a durable journal means a local on-disk record of each flushed `QueueBatch` that survives process restart

The target end state is:

1. fact writes still happen on the existing batched path
2. the hot path stops doing Turso rollup reads inline
3. rollups converge on a second timer controlled by `rollupDelayMs`
4. pending rollup work is durable and survives restart
5. `queue.flush()`, process exit, and orphan replay still force convergence
6. v1 does not add fact-count thresholds or event-specific force paths
7. realistic tests come from committed SQLite fixture files, while queue scheduler tests stay small and failure-focused

Running example used throughout this plan:

1. one root session
2. one user message
3. one assistant message with `finish: "tool-calls"`
4. one `step-start`
5. two `tool` parts such as `read` and `grep`

This is the kind of shape that is easy to miss with hand-written toy events but common enough to matter for this refactor.

Why this changes the plan: the first implementation should solve the runtime bottleneck, the proof problem, and the durability requirement together. The design can stay timer-only, but it can no longer rely on in-memory rollup invalidations as the source of truth.

## Starting Point, Driving Problem, And Finish Line

Question: where are we now, what is wrong with it, and where do we need to end up?

Short answer: the queue already batches facts, but each flushed batch still recomputes rollups immediately. At the same time, the current tests are strongest on small synthetic event objects and weaker on real multi-part session shapes. The current failure durability boundary only covers failed fact batches, not pending rollup work.

Confirmed starting point:

1. `plugins/usage-tracker/index.js` sends every plugin event to `queue.enqueue(event)`.
2. `plugins/usage-tracker/queue.js` batches normalized facts for `flushDelayMs`, which defaults to `150`.
3. When that timer fires, `flushBatch(batch)` currently does three things in order: `turso.writeFacts(batch.facts)`, `recomputeTouchedRollups(turso, batch.touched)`, and `turso.replaceRollups(rollups)`.
4. `plugins/usage-tracker/rollups.js` recomputes nine rollup families from the fact tables.
5. `plugins/usage-tracker/test/queue.test.js` uses fake timers and hand-written events.
6. `plugins/usage-tracker/test/history.test.js` already proves this repo can test against OpenCode-shaped SQLite databases.
7. `plugins/usage-tracker/outbox.js` durably persists failed batches only. It is not the current source of truth for all flushed work.

Driving problem:

1. a user-visible event path is cheap until the batch flush starts
2. once the flush starts, the path pays for fact writes and then immediate rollup reads
3. the rollup read work scales with touched keys, not just with the size of the fact batch
4. the current test mix makes it too easy to miss real-world compositions while also making queue tests broader than they need to be
5. if rollup work moves out of the hot path, pending rollup invalidations must still survive restart

Finish line:

```text
event
  -> normalizeEvent()
  -> queue.enqueue()
  -> fact batch timer fires
  -> persist QueueBatch durably
  -> later write facts to Turso
  -> merge touched keys into in-memory rollup working set
  -> return

later, on rollup timer or explicit flush:
  -> recomputeTouchedRollups(...)
  -> turso.replaceRollups(...)
  -> remove durable journal entries only after success
```

The finish line is not "zero rollup reads forever." The finish line is "zero rollup reads on the hot path before the rollup timer fires," with durable recovery and realistic fixture coverage proving that the same guarantee still holds for tool-heavy sessions and historical hydration paths.

Why this changes the plan: the runtime fix is a queue refactor, but the delivery plan also needs a stronger durability model and a better testing split so the refactor is verified against real data shapes without making scheduler tests hard to diagnose.

## Constraints And Assumptions

Question: what must stay true while we change this?

Short answer: preserve the current fact semantics, keep the scheduling policy simple in v1, require durable pending rollup work, and make realistic tests committed and local rather than generated from a developer's personal database at test time.

Confirmed constraints:

1. `plugins/usage-tracker/history.js` performs local SQLite hydration reads before normalization. Those reads are separate from the Turso rollup pressure and should stay out of scope for the first runtime change.
2. `plugins/usage-tracker/queue.js` intentionally keeps startup cheap today. `queue.start()` does no Turso work, and schema creation waits for the first real flush.
3. `plugins/usage-tracker/index.js` relies on `queue.flush()` during `exit`, `usage-tracker-flush`, and `tool.execute.before` hooks for maintenance commands.
4. `plugins/usage-tracker/rollups.js` and `plugins/usage-tracker/schema.js` already encode the current rollup semantics. The first patch should keep those semantics and only change when recomputation happens.
5. `plugins/usage-tracker/index.d.ts` already defines `QueueBatch` as one object containing `batchID`, `createdAt`, `facts`, and `touched`.

Confirmed durability constraints:

1. pending rollup durability is required, not optional
2. the preferred shape is one single durable source of truth, not a durable fact store plus an in-memory-only rollup store
3. in-memory rollup state is still acceptable as a working set, but not as the only record of pending work
4. deterministic replay is a correctness requirement

Concrete example from the real repo:

1. `schema.js` builds fact upserts as `ON CONFLICT ... DO UPDATE SET column = excluded.column`
2. that means replaying an older durable batch after a newer one can overwrite newer row values
3. so replay order cannot be a best-effort behavior. It has to be explicit and deterministic

Confirmed testing constraints:

1. `plugins/usage-tracker/test/queue.test.js` already has deterministic fake timers and fake Turso counters. That harness should stay, but it should be used for narrow scheduler and recovery tests.
2. `plugins/usage-tracker/test/history.test.js` already creates temporary OpenCode-shaped SQLite databases. That is the closest existing pattern to committed SQLite fixtures.
3. `opencode-stats-sync-script/src/lib/open-code-db.ts` already knows how to read the real OpenCode SQLite schema. That makes SQLite fixture files a realistic, source-backed test input choice.

Confirmed tricky behavior to preserve:

1. `queue.replayAllOutbox()` currently converges rollups because orphan replay still calls the inline `flushBatch()` path.
2. After the split, that behavior will not remain true automatically. It has to be preserved deliberately, or `usage-tracker-replay-all` will silently weaken.

Inferred assumptions:

1. short rollup staleness is acceptable for the first implementation, but the exact freshness requirement is not encoded anywhere in this repo
2. SQLite rename-based local persistence is good enough for the required journal, because the repo already relies on that pattern in `outbox.js`

Plan decision for v1:

1. use a timer-only scheduling policy
2. do not add fact-count thresholds
3. do not add event-specific force or fast paths
4. require one durable journal for flushed batches
5. require deterministic replay order

Why this decision follows from current evidence:

1. the current event model already contains several plausible boundary signals such as assistant `finish: "end-turn"`, assistant `finish: "tool-calls"`, `step-finish`, and later tool parts
2. adding a fast path now would mix a freshness policy decision into a queue refactor whose main goal is simply to remove inline rollup reads
3. the user has explicitly chosen the simpler timer-only path and required durability for pending rollups
4. the existing `QueueBatch` shape and `outbox.js` atomic write pattern already support a single durable journal approach

Recommended default:

1. start with `rollupDelayMs = 15000`

That number is a recommendation, not a confirmed requirement. It is long enough to collapse bursts into one pass, but still short enough for a human checking recent usage to see fresh numbers quickly.

Why this changes the plan: these constraints point to a small queue refactor plus a clearer test architecture, but they also force durability into the mainline design. The old "accept the crash window first" approach is no longer valid.

## Current State

Question: what does the code do today?

Short answer: the queue already batches facts well, but it still treats rollup recomputation as part of the same write operation, and the current durability model only protects failed fact batches rather than every flushed batch.

Confirmed current runtime behavior for the running example:

1. `plugins/usage-tracker/normalize.js` turns each event into fact rows plus touched keys.
2. `normalizeEvent()` calls `remember()`, which adds touched project IDs, day keys, model keys, tool keys, and every affected ancestor session ID through `collectAffectedSessionIDs()`.
3. `plugins/usage-tracker/queue.js` merges those facts into `pendingFacts` and merges touched keys into `pendingTouched`.
4. When the fact timer fires, the queue creates one `QueueBatch` with both `facts` and `touched`.
5. `flushBatch()` writes facts first, then immediately recomputes rollups for the same batch.
6. If a fact write fails, `processLoop()` persists the whole batch, including `touched`, into the durable outbox.

Confirmed read hotspots inside the rollup layer:

1. `recomputeTouchedRollups()` fans out into nine families: session, session-model, project, project-model, tool, daily-global, daily-model, daily-tool, and daily-project.
2. `recomputeSessionModelRollups()` and `recomputeProjectModelRollups()` first read existing rollup rows to build delete keys.
3. `recomputeDailyProjectRollups()` performs its main aggregate query and then two extra `COUNT(*)` queries to decide whether the row should exist.
4. Several families loop one key at a time, so one event burst can turn into many separate `turso.query()` calls.

Confirmed current durability behavior:

1. `outbox.persist(batch)` writes the whole `QueueBatch` to `~/.local/share/opencode/usage-outbox/<process>/<batch>.json` using `*.tmp` then `renameSync()`.
2. `outbox.list()` and `listAllOrphans()` order files by `mtimeMs`.
3. `queue.replayAllOutbox()` replays durable files by calling the same `flushBatch()` path used for live work.

Why that matters:

1. the current durable model already stores both `facts` and `touched`, which is the right unit for a single durable journal
2. but it only activates on failure, and replay ordering currently depends on filesystem metadata rather than an explicit logical order

Confirmed current test state:

1. `plugins/usage-tracker/test/queue.test.js` currently passes and already proves the old path produces `queryCount > 0` after the fact timer runs.
2. `plugins/usage-tracker/test/normalize.test.js` contains many small event-level assertions for edge cases such as synthetic text handling, step ID selection, and session lineage.
3. `plugins/usage-tracker/test/history.test.js` uses temporary SQLite databases to verify hydration behavior against OpenCode-shaped tables.
4. `opencode-stats-sync-script/src/lib/derive.test.ts` covers more realistic message and part compositions, including `finish: "tool-calls"`.

Confirmed current gap:

1. there is no committed SQLite fixture directory under `plugins/usage-tracker/test/`
2. the queue tests are using a representative event sequence, but that sequence is still hand-built rather than loaded from a realistic persisted source
3. there is no durable mainline representation of "fact write succeeded but rollups still pending"
4. replay order is not documented as a first-class correctness rule

Why this changes the plan: the repo already has the ingredients for the new testing split and for the durable journal shape. It does not need a new framework. It needs committed SQLite fixtures, a single durable source of truth for flushed batches, and an explicit replay-order contract.

## What Is Actually Causing The Problem

Question: what is the real cause of the runtime problem, and what are the real causes of the durability and testing concerns?

Short answer: the runtime problem is the coupling inside `flushBatch()`. The durability problem is that pending rollup work has no mainline durable record. The testing concern is that realistic coverage and scheduler-focused coverage are mixed poorly today.

Runtime cause chain:

1. one event burst becomes one normalized `QueueBatch`
2. that batch writes facts successfully
3. the same batch immediately triggers `recomputeTouchedRollups()`
4. the touched set spans several rollup families
5. several families query one key at a time or do extra existence reads

Using the running example:

1. the user message creates or updates a turn and touches the session lineage and day key
2. the assistant message creates a response, touches the same session lineage again, and adds a model key
3. the tool parts create tool calls and payload rows, add tool keys, and may add more day keys
4. once the batch flushes, `recomputeTouchedRollups()` has enough touched state to fan out across session, project, daily, model, and tool rollups

This means the write path does not scale with "rows written." It scales with "how many rollup families and keys the burst touched."

Durability cause chain:

1. once rollups move off the hot path, facts and rollup invalidations stop completing in one step
2. if the only durable state is a failure-only outbox, then successful fact writes can still leave pending rollups with no durable record
3. if replay ordering is not explicit, older durable batches can overwrite newer fact rows during restart recovery because the upsert model updates all non-primary-key columns from `excluded`

Concrete example from the real repo:

1. `schema.js` generates `INSERT ... ON CONFLICT DO UPDATE SET ... = excluded...` for fact tables
2. `turso.writeFacts()` uses those statements for every fact write
3. so replaying `batch A` after newer `batch B` can move a row backward if both touched the same primary key

Testing cause chain:

1. small unit tests are good at proving precise normalization edge cases
2. realistic OpenCode session shapes are better represented by persisted SQLite data than by long hand-built event objects
3. queue scheduling tests become harder to understand if they also try to cover every realistic event composition

That is why all of these statements can be true at once:

1. queue tests should get smaller
2. the overall test strategy should get more realistic
3. restart recovery needs its own explicit test layer

Confirmed non-cause for the first patch:

1. local SQLite hydration in `history.js` may still be worth optimizing later, but it is not the main synchronous Turso read hotspot
2. SQL tuning inside `rollups.js` may still help later, but even perfect SQL would leave the queue doing rollup reads inline if the coupling stays in place
3. trigger heuristics such as fact-count thresholds are not required to get the first large read reduction

Why this changes the plan: the plan should remove the queue coupling, change the durability model, and change the test architecture together. It should not mix in a second policy decision about when certain events deserve faster rollup freshness.

## Options Considered

Question: what realistic implementation paths are available?

Short answer: there are four real options, and one of them gives the main win with the smallest safe change that still satisfies the durability requirement.

### Option 1: Keep Immediate Rollups And Optimize SQL First

What it is:

1. leave `flushBatch()` as the place where fact writes and rollups both happen
2. reduce query count inside `rollups.js`

Pros:

1. no new staleness window
2. no new background scheduling state
3. no new durability model

Cons:

1. the hot path still waits for rollup work
2. even a better query shape still keeps reads inline with user-visible writes
3. the SQL work is broader and harder to verify than a queue refactor

When it makes sense:

1. if immediate rollup freshness is a hard requirement and any delay is unacceptable

Decision: reject for the first implementation.

Why: it improves the expensive part, but not the architectural coupling causing the visible pressure.

### Option 2: Timer-Only Deferred Rollups With Layered Tests But In-Memory Rollup Invalidations

What it is:

1. let fact writes stay on the current queue path
2. after successful fact persistence, merge touched keys into an in-memory pending rollup accumulator
3. recompute rollups later on a separate timer
4. use committed SQLite fixtures for realistic integration coverage
5. keep queue scheduler tests narrow and failure-focused

Pros:

1. smallest runtime diff from the current queue
2. simple scheduler
3. realistic fixture coverage is closer to actual OpenCode data shapes

Cons:

1. does not satisfy the new durability requirement
2. leaves a crash window if the process dies after fact writes succeed but before the rollup timer runs
3. still requires a second source of truth if durability is added later

When it makes sense:

1. only if pending rollup durability is optional

Decision: reject.

Why: the user has explicitly made durability a must, so this is no longer an acceptable target state.

### Option 3: Timer-Only Deferred Rollups With A Single Durable Journal And In-Memory Working Set

What it is:

1. persist every flushed `QueueBatch` durably before remote work starts
2. keep that journal as the single source of truth until rollups succeed
3. use memory only as a working set for scheduling and coalescing
4. replay journal entries in deterministic order on restart
5. use committed SQLite fixtures for realistic integration coverage
6. keep queue scheduler and recovery tests narrow and failure-focused

Pros:

1. removes synchronous rollup reads from the hot path
2. satisfies the durable pending rollup requirement
3. keeps one durable unit containing both `facts` and `touched`
4. avoids splitting facts and invalidations across separate durable stores
5. realistic fixture coverage is closer to actual OpenCode data shapes
6. queue tests remain easier to debug because they focus on one scheduler or recovery concern at a time

Cons:

1. larger change than a pure in-memory scheduler split
2. requires explicit replay-order metadata and tests
3. means startup or recovery logic can no longer remain purely local and empty

Concrete example from the real repo:

1. `QueueBatch` already contains `facts` and `touched`
2. `outbox.js` already provides an atomic JSON persistence pattern
3. `turso.writeFacts()` and `turso.replaceRollups()` are already shaped in a way that makes deterministic replay plausible

When it makes sense:

1. when the goal is immediate read reduction, timer-only scheduling, and required durability without splitting truth across multiple stores

Decision: accept for the first implementation.

Why: it directly addresses the current bottleneck, satisfies the durability requirement, and stays closer to the existing batch shape than introducing multiple durable stores.

### Option 4: Deferred Rollups Plus Fast Paths Or Threshold Heuristics

What it is:

1. start from Option 3
2. add early rollup triggers based on fact count, message type, assistant finish reason, or some similar heuristic

Pros:

1. could reduce perceived staleness for some interactions
2. could let the system react differently to short turns versus long tool-heavy turns

Cons:

1. adds a second design problem on top of the queue split and journal work
2. the current event model has several plausible boundary signals, so the fast path would need another product-level decision
3. makes testing more complex because queue timing now depends on event classification rules, not just timer state

Concrete example from the real repo:

1. `normalize.test.js` and `derive.test.ts` already show assistant `finish: "end-turn"`, assistant `finish: "tool-calls"`, `step-finish`, and later tool parts
2. that means a force rule would need to decide which of those actually means "refresh now"

When it makes sense:

1. only after timer-only scheduling lands and measured staleness proves unacceptable

Decision: reject for v1.

Why: the first patch should keep scheduling policy simple. This is a follow-up product decision, not part of the minimal refactor.

Why this changes the plan: Option 3 gives the main win with the least scope that still satisfies the new durability requirement. Option 4 remains a real follow-up only if measurement justifies it.

## Recommended Approach

Question: what should we do first?

Short answer: split fact persistence from rollup refresh in `queue.js`, keep scheduling timer-only, and replace the failure-only outbox mental model with a single durable ordered journal plus an in-memory rollup working set.

Recommended runtime behavior:

1. keep the current fact batching timer and `flushDelayMs`
2. add a second option, `rollupDelayMs`, with an initial default of `15000`
3. when the fact timer materializes a batch, persist that `QueueBatch` durably before remote work starts
4. add explicit replay-order metadata such as a per-process monotonic sequence, and do not rely on `mtime` as the primary correctness mechanism
5. process durable journal entries in deterministic order
6. after a durable batch's facts are successfully written, merge its `touched` keys into an in-memory rollup working set
7. do not delete the durable batch yet
8. run `flushRollups()` later on the rollup timer using the in-memory working set derived from durable journal entries
9. delete durable journal entries only after `replaceRollups()` succeeds for the covered work
10. on restart, rebuild the in-memory rollup working set from surviving journal entries and resume processing automatically
11. make `queue.flush()` drain both the journal-backed fact work and the journal-backed rollup work before returning
12. make `queue.replayAllOutbox()` or its successor preserve the same deterministic full-convergence semantics for orphan recovery

Explicitly out of scope for v1:

1. fact-count thresholds
2. assistant-finish-based fast paths
3. user-message-based force paths
4. SQL rewrites in `rollups.js`

Recommended testing split:

1. keep `plugins/usage-tracker/test/queue.test.js` for small scheduler, recovery, and failure tests
2. add committed SQLite fixtures under `plugins/usage-tracker/test/fixtures/`
3. add fixture-driven integration tests for realistic conversation shapes
4. keep `plugins/usage-tracker/test/normalize.test.js` focused on small edge cases instead of turning it into a broad integration file
5. update `plugins/usage-tracker/test/history.test.js` to reuse committed fixtures where that reduces duplication

Recommended implementation detail for correctness:

1. use a shared in-flight promise or equivalent coordination for the rollup runner so a timer callback and `flush()` can join the same work instead of racing
2. make durable replay order explicit in filenames or payload fields, then test that order directly

Relationship to the existing runbooks:

1. this file should be the top-level decision document
2. `PHASE-1-END-STATE-TESTS.md`, `PHASE-2-BACKGROUND-ROLLUP-SCHEDULING.md`, `PHASE-3-FORCED-FLUSH-CONVERGENCE.md`, and `PHASE-4-FAILURE-AND-DURABILITY.md` should remain the execution checklists
3. those runbooks should now be read through the timer-only, SQLite-fixture, and required-durability decisions made here

Why this changes the plan: it keeps the runtime change centered on the queue, satisfies the durable pending rollup requirement with one source of truth, and improves the quality of the evidence without widening scope into a second scheduling policy.

## Step-By-Step Implementation Plan

Question: in what exact order should this be implemented?

Short answer: add the fixture layer first, reshape the tests around it, then replace the failure-only outbox model with a durable ordered journal and finally refactor the queue around that journal.

### Step 1: Add Committed SQLite Fixture Files

Files to add:

1. `plugins/usage-tracker/test/fixtures/`
2. a small shared helper such as `plugins/usage-tracker/test/fixture-db.js` if the tests need a common way to locate or copy fixtures

Required work:

1. create small, sanitized SQLite fixture files that use the same OpenCode table shape that `history.js` expects: `session`, `message`, and `part`
2. derive those fixtures from realistic OpenCode DB slices rather than inventing them from scratch
3. keep them committed in the repo so tests do not depend on each developer's local `~/.local/share/opencode/opencode.db`
4. keep each fixture narrow enough that failures are still readable

Minimum fixture set:

1. a simple user -> assistant `end-turn` fixture
2. a tool-heavy turn fixture with `finish: "tool-calls"`, `step-start`, and multiple tool parts
3. a lineage fixture with parent and child sessions
4. a historical hydration fixture where old data changes touched days or tool-day keys

Why this step comes first:

1. it locks in the realistic inputs before the queue behavior changes
2. it avoids designing the scheduler and recovery tests around toy event data only

### Step 2: Reshape The Test Strategy Into Two Layers

Files to change:

1. `plugins/usage-tracker/test/queue.test.js`
2. `plugins/usage-tracker/test/history.test.js`
3. `plugins/usage-tracker/test/normalize.test.js` only where a small supporting change helps reuse fixtures
4. a new fixture-driven integration file such as `plugins/usage-tracker/test/queue-fixture.test.js`

Required work:

1. keep `queue.test.js` narrow and focused on scheduler, recovery, and durability mechanics
2. move realistic end-to-end conversation compositions into the fixture-driven integration file
3. update `history.test.js` to reuse the committed fixtures where practical instead of rebuilding very similar databases inline
4. keep `normalize.test.js` for small semantics like synthetic text handling, canonical step IDs, and session lineage edge cases

Recommended small queue tests:

1. `persists batch before remote fact write starts`
2. `replays surviving batches in deterministic order after restart`
3. `no rollup queries happen before the rollup timer fires`
4. `rollup timer runs recomputation after callback`
5. `rollup failure leaves durable work pending`
6. `fact write failure keeps durable work pending for replay`
7. `flush drains durable facts and durable rollup work`
8. `orphan replay converges before returning`

Recommended fixture-driven integration assertions:

1. a realistic fixture still writes facts before any rollup query occurs
2. the same fixture produces rollup reads only after the rollup timer fires
3. tool-heavy fixtures touch day, tool, session, and model rollup families as expected
4. lineage fixtures still touch ancestor sessions correctly
5. historical fixtures still prove hydration changes touched keys correctly

Important rule:

1. do not snapshot exact global query counts from every fixture
2. do assert the semantic boundary that matters: zero rollup reads before the timer, then convergence after the timer

Why this step changes the plan: it satisfies both requirements at once. The tests get more realistic overall while `queue.test.js` gets smaller and easier to diagnose.

### Step 3: Replace The Failure-Only Outbox With A Mainline Durable Journal

Files to change:

1. `plugins/usage-tracker/outbox.js` or a renamed successor such as `journal.js`
2. `plugins/usage-tracker/index.d.ts`
3. `plugins/usage-tracker/queue.js`

Required work:

1. change the storage abstraction from "failed batches only" to "all flushed batches"
2. persist `QueueBatch` records before remote fact writes begin
3. add explicit replay-order metadata such as a per-process monotonic sequence number
4. stop treating `mtime` as the primary correctness mechanism for replay order
5. keep atomic local persistence with `*.tmp` then rename, because that pattern already exists and is understood in this repo
6. update type comments and interfaces to reflect that durable files are now the mainline journal, not only a failure outbox

Preferred shape:

1. one durable journal of `QueueBatch` records as the source of truth
2. in-memory rollup state as a working set only

Why this step matters:

1. it is the smallest model that satisfies the new durability requirement without splitting facts and invalidations across separate durable stores

### Step 4: Refactor `queue.js` Around The Durable Journal

Files to change:

1. `plugins/usage-tracker/queue.js`

Required work:

1. add `rollupDelayMs` to the queue options JSDoc and types
2. keep `pendingFacts` and `pendingTouched` only for the pre-journal in-memory batch accumulator
3. when the fact timer fires, serialize one `QueueBatch`, assign explicit replay-order metadata, persist it durably, then clear the pre-journal accumulator
4. process durable journal entries in deterministic order when writing facts to Turso
5. after a journal entry's facts succeed, merge its `touched` keys into an in-memory rollup working set
6. do not delete the durable journal entry yet
7. keep an in-memory map of which durable entries are still awaiting rollup completion
8. do not add any `forceRollupNow`, `rollupThreshold`, or event-classification logic in this patch

This preserves the current fact semantics while changing the durability boundary from "only on failure" to "before remote work starts."

### Step 5: Add The Background Rollup Runner

Files to change:

1. `plugins/usage-tracker/queue.js`

Required work:

1. add `scheduleRollupFlush()`
2. add `flushRollups()`
3. when a rollup run starts, snapshot the in-memory rollup working set into a local variable and clear the shared accumulator for new arrivals
4. run `recomputeTouchedRollups(turso, touched)` and then `turso.replaceRollups(rollups)`
5. on success, remove the covered durable journal entries
6. on failure, keep the durable journal entries and merge the touched set back into the in-memory working set
7. if more touched keys arrived during the run, schedule exactly one more pass afterward
8. once a rollup timer is scheduled, do not keep postponing it forever just because new writes keep arriving

Why no fast path is added here:

1. the goal of this step is to move work off the hot path
2. any trigger heuristic would add a second behavior change that is not required to prove the main win

### Step 6: Preserve Explicit Convergence Boundaries And Restart Recovery

Files to change:

1. `plugins/usage-tracker/queue.js`
2. `plugins/usage-tracker/index.js` only if a small comment or behavior cleanup is truly needed
3. recovery tooling that still assumes a failure-only outbox, if needed

Required startup and flush behavior:

1. on startup or initialization, scan the durable journal and rebuild any needed in-memory working state
2. `flush()` must cancel the fact timer
3. `flush()` must materialize pending in-memory facts into the durable journal
4. `flush()` must process durable journal entries in deterministic order until facts are applied
5. `flush()` must cancel the rollup timer
6. `flush()` must run or join `flushRollups()` until the durable journal is empty

Required orphan replay behavior:

1. orphan replay must preserve deterministic full-convergence semantics
2. it must not stop at "facts persisted"
3. it must force rollup convergence before returning, or `usage-tracker-replay-all` will no longer match its current maintenance meaning

Why this step matters:

1. the runtime may be eventually consistent during normal flow
2. durability and maintenance boundaries still need to be deterministic

### Step 7: Keep The First Patch Narrow

Files that should usually stay unchanged in the first patch:

1. `plugins/usage-tracker/rollups.js`
2. `plugins/usage-tracker/history.js`

Allowed exceptions:

1. tiny supporting edits needed to keep types, comments, or tests accurate

Out of scope for this step:

1. removing rollup tables
2. rewriting rollup SQL
3. changing event normalization semantics
4. adding trigger heuristics or thresholds

Why this step changes the plan: it protects the main goal from scope creep. The first implementation should be easy to reason about because it changes the durability boundary and one runtime policy: rollups move from inline to timer-based.

### Step 8: Decide Whether SQL Optimization Or Trigger Heuristics Are Needed Later

Decision gate after the durable timer-only scheduler lands:

1. if hot-path reads are gone and recovery works correctly, stop
2. if background reads are still too expensive even after coalescing, move to SQL optimization in `PHASE-5-SQL-OPTIMIZATIONS.md`
3. only if measured staleness proves unacceptable should the team reopen the trigger-heuristic discussion

Why this changes the plan: this order front-loads the biggest likely win, keeps tests green and deterministic, and postpones every second-order decision until after the durable timer-only design is measured.

## Risks And Failure Modes

Question: what can go wrong with this design?

Short answer: the main implementation risks are incorrect replay order, journal cleanup bugs, and coordination mistakes between the timer and flush paths.

### Risk 1: Durable Replay Order Is Not Deterministic

What can happen:

1. the journal is replayed by filesystem `mtime` or some other unstable ordering
2. an older batch replays after a newer batch that touched the same fact row

Effect:

1. fact rows can be overwritten with stale values

Mitigation:

1. persist explicit replay-order metadata
2. sort by that metadata, not by `mtime`, for correctness
3. add restart-recovery tests that prove ordered replay

### Risk 2: Facts Succeed But Durable Journal Entries Are Deleted Too Early

What can happen:

1. facts are written successfully
2. the journal entry is removed before rollups succeed
3. the process crashes or the rollup run fails

Effect:

1. the system loses the only durable record of pending rollup work

Mitigation:

1. delete durable entries only after successful rollup replacement
2. test that rollup failure leaves durable work behind

### Risk 3: Timer And `flush()` Race And Lose Dirty Keys

What can happen:

1. a timer callback starts `flushRollups()` while `queue.flush()` is also trying to converge
2. both paths clear or reuse the same in-memory working set incorrectly

Effect:

1. dirty keys can be dropped, duplicated, or retried forever

Mitigation:

1. use one shared rollup in-flight promise or equivalent lock
2. snapshot dirty keys out of shared state before running queries
3. merge them back on failure
4. add narrow queue tests that exercise timer plus `flush()` overlap indirectly through deterministic scheduling

### Risk 4: `usage-tracker-replay-all` Quietly Stops Converging Rollups

What can happen:

1. orphan replay writes facts successfully
2. the new queue only schedules a later rollup timer
3. the maintenance tool returns before the rollup timer runs

Effect:

1. the tool appears successful but leaves stale rollups behind

Mitigation:

1. make orphan replay force rollups before returning
2. add a small queue test for orphan replay convergence

### Risk 5: Constant Load Starves Rollup Execution

What can happen:

1. each new journal-backed fact batch keeps postponing the rollup timer
2. rollups never run during sustained activity

Effect:

1. eventual consistency becomes unbounded, which defeats the purpose of having a bounded delay

Mitigation:

1. once a timer is scheduled, let it fire
2. if new dirty keys arrive during a rollup run, schedule one follow-up pass after the current run completes

### Risk 6: Queue Tests Stay Too Broad To Debug

What can happen:

1. `queue.test.js` tries to prove scheduler behavior, replay ordering, realistic event composition, and hydration behavior all at once
2. one failure now hides the actual cause behind a large fixture flow

Mitigation:

1. keep `queue.test.js` focused on scheduler, ordering, and durability mechanics
2. move realistic compositions into fixture-driven integration tests

### Risk 7: SQLite Fixture Tests Become Hard To Maintain Or Leak Sensitive Data

What can happen:

1. fixture files are too large or too close to a real private database
2. assertions start snapshotting too much accidental detail

Mitigation:

1. commit only small sanitized fixture slices
2. assert behavior that matters, not every row or every query string
3. document how fixtures were derived so they can be refreshed intentionally later

### Risk 8: Tests Become Timing-Sensitive Again

Mitigation:

1. keep using injected timer functions in queue tests
2. keep `sleepFn` injectable and no-op in tests
3. do not make fixture-driven tests depend on real waiting either

Why this changes the plan: these risks are manageable, but only if the implementation keeps scheduling simple, durability explicit, and fixture realism separate from scheduler mechanics.

## Verification Plan

Question: how do we know the change worked?

Short answer: the proof should come from two complementary layers. Narrow queue tests prove scheduling, ordering, durability, and failure semantics. SQLite-fixture integration tests prove those semantics still hold for realistic data shapes.

Required development commands:

```bash
bun test plugins/usage-tracker/test/queue.test.js
bun test plugins/usage-tracker/test/history.test.js
bun test plugins/usage-tracker/test/normalize.test.js
bun test plugins/usage-tracker/test
```

If a separate integration file is added, also run it directly during development.

Required queue-level assertions:

1. a flushed batch is persisted durably before remote fact write begins
2. replay after restart uses explicit deterministic order
3. before the rollup timer fires, `queryCount === 0`
4. after the rollup timer fires once, `queryCount > 0`
5. rollup failure leaves durable work pending
6. successful rollup completion removes the covered durable work
7. `queue.flush()` returns only when the durable journal is drained for already-known work
8. orphan replay returns only after facts and rollups are converged

Required fixture-driven assertions:

1. the simple turn fixture still writes facts before any rollup query occurs
2. the tool-heavy fixture still produces zero rollup reads before the rollup timer fires
3. after the timer, the same tool-heavy fixture touches rollup families consistent with its facts: session, project, day, model, and tool
4. the lineage fixture still proves ancestor sessions are touched correctly
5. the historical hydration fixture still proves that old data can change touched day or tool keys correctly

Important verification rule:

1. do not lock the test suite to exact total query counts from every fixture
2. do lock the suite to the semantic boundary that matters: zero rollup reads before the timer, then convergence after the timer
3. do lock the suite to explicit replay ordering and durable recovery semantics

Recommended operational checks against a real Turso environment:

From `opencode-stats-sync-script/`:

```bash
bun run verify
```

This only prints coarse counts, but it is still useful for confirming that the analytics tables remain populated after the refactor.

Success criteria for the first implementation:

1. hot-path rollup reads are zero before the rollup timer fires
2. pending rollup work survives restart
3. deterministic replay is covered by tests and works in practice
4. rollups still converge automatically later
5. explicit `flush()` remains deterministic
6. orphan replay remains deterministic
7. no existing normalize, outbox, history, or schema tests regress
8. realistic SQLite fixtures now cover the main conversation shapes that the queue tests should not have to encode by hand

Why this changes the plan: the plan is only worth taking if the proof is stronger than "it seems faster." The layered test strategy makes that proof more realistic without making every failure harder to understand.

## Rollback Or Recovery Plan

Question: what do we do if the new scheduler is wrong or the journal design proves flawed?

Short answer: revert the queue behavior for future writes, keep the improved tests if they are still useful, and use the existing stats sync toolkit to repair facts or rollups already in Turso.

### Code Rollback

1. revert the queue refactor so `flushBatch()` again recomputes rollups inline
2. revert or disable the durable mainline journal only if the rollback also restores a coherent single-path write model
3. keep the improved fixture and queue tests if they still describe the intended behavior and make the old behavior easier to compare

### Data Recovery When Facts Are Correct But Rollups Are Stale

From `opencode-stats-sync-script/`:

```bash
bun run rebuild-rollups
```

Confirmed behavior:

1. `src/commands/rebuild-rollups.ts` calls `rebuildRollups()` after ensuring schema
2. `src/lib/rollups.ts` clears every rollup table and rebuilds them from the fact tables already in Turso

This is the primary repair path if the journal-driven scheduler leaves rollups stale.

### Recovery When Durable Journal Entries Still Exist

From `opencode-stats-sync-script/` or updated replay tooling:

```bash
bun run replay-outbox
```

Current confirmed behavior:

1. `src/commands/replay-outbox.ts` replays durable fact batches from `~/.local/share/opencode/usage-outbox/`
2. after replay, it runs `rebuildRollups()` before removing replayed files

Planned implication:

1. if the durable storage model changes from failure-only outbox to mainline journal, this tooling must be updated to understand that layout

### Full Reset And Rebuild

From `opencode-stats-sync-script/`:

```bash
bun sync-to-turso.js backfill-opencode-db --fresh
```

Use this only if a full analytics rebuild is needed. It drops analytics tables, recreates schema, reloads facts from the OpenCode SQLite database, and rebuilds rollups.

### Forward Recovery

1. if the timer-only scheduler works but journal cleanup or replay semantics are flawed, fix the journal model first rather than patching around it with ad hoc trigger rules
2. only after the durable timer-only baseline is stable should the team consider SQL optimization or trigger heuristics

Why this changes the plan: the first pass is acceptable only if the new durability model is itself trustworthy. The old manual repair path remains useful, but it is no longer the primary correctness story.

## Sources

Primary repo sources:

1. `plugins/usage-tracker/index.js` for event wiring, maintenance tools, and exit-time flush behavior
2. `plugins/usage-tracker/queue.js` for the current fact batching path, inline `flushBatch()` behavior, outbox replay, and `flush()` semantics
3. `plugins/usage-tracker/normalize.js` for touched-key expansion through `remember()` and `collectAffectedSessionIDs()`
4. `plugins/usage-tracker/rollups.js` for the nine rollup families and their current query patterns
5. `plugins/usage-tracker/turso.js` for fact writes, rollup replacement, and raw query execution
6. `plugins/usage-tracker/outbox.js` for the current atomic batch-persistence pattern and replay ordering behavior
7. `plugins/usage-tracker/history.js` for the separate SQLite hydration path kept out of scope for the first runtime change
8. `plugins/usage-tracker/index.d.ts` for the current `QueueBatch` shape
9. `plugins/usage-tracker/test/queue.test.js` for the existing fake timer harness and current representative event sequence
10. `plugins/usage-tracker/test/normalize.test.js` for current edge-case event coverage and examples of `finish: "end-turn"`, `step-finish`, and tool parts
11. `plugins/usage-tracker/test/history.test.js` for current OpenCode-shaped SQLite test coverage
12. `plugins/usage-tracker/PHASE-1-END-STATE-TESTS.md`
13. `plugins/usage-tracker/PHASE-2-BACKGROUND-ROLLUP-SCHEDULING.md`
14. `plugins/usage-tracker/PHASE-3-FORCED-FLUSH-CONVERGENCE.md`
15. `plugins/usage-tracker/PHASE-4-FAILURE-AND-DURABILITY.md`

Fixture and data-shape sources:

1. `opencode-stats-sync-script/src/lib/open-code-db.ts` for the real OpenCode SQLite table loading shape
2. `opencode-stats-sync-script/src/lib/derive.ts` for realistic message and part composition handling
3. `opencode-stats-sync-script/src/lib/derive.test.ts` for realistic examples including assistant `finish: "tool-calls"`

Recovery and operations sources:

1. `opencode-stats-sync-script/README.md` for the documented maintenance commands
2. `opencode-stats-sync-script/package.json` for runnable script names
3. `opencode-stats-sync-script/src/commands/rebuild-rollups.ts` for the rollup rebuild entrypoint
4. `opencode-stats-sync-script/src/lib/rollups.ts` for full rollup rebuild behavior
5. `opencode-stats-sync-script/src/commands/replay-outbox.ts` for durable replay and post-replay rollup rebuild
6. `opencode-stats-sync-script/src/commands/backfill-opencode-db.ts` for full backfill and rebuild behavior

Local command used while preparing this rewrite:

1. `bun test plugins/usage-tracker/test/queue.test.js`
