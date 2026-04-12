---
name: phase-execution-briefs
description: Turn an implementation plan into one agent-ready markdown brief per phase, with dependency checks, readiness status, target measurements, implementation details, verification, and next-phase handoff.
compatibility: opencode
metadata:
  audience: engineers
  style: execution
---

# Phase Execution Briefs Skill

## What I do

Use this skill when the user already has an implementation plan and wants to turn it into phase-by-phase execution documents that another agent can pick up immediately.

Examples:
- split a migration plan into one markdown file per phase
- turn a rollout plan into execution-ready phase briefs
- convert a refactor plan into phase packets with clear entry and exit criteria
- turn an approved implementation strategy into agent-followable work documents

The goal is not to rewrite the implementation plan.

The goal is to operationalize it into a set of markdown files where each file answers:
- what this phase is for
- whether this phase can start now
- what must already be done
- what target measurements matter
- what exact work should happen in this phase
- how to verify it is done
- what phase becomes unblocked next

This skill should produce writing that is:
- execution-ready
- dependency-aware
- measurement-aware
- source-backed
- handoff-friendly

## When to use me

Use this skill when the user wants:
- one markdown file per phase
- agent-ready execution docs
- clear dependency gates between phases
- explicit start criteria
- explicit done criteria
- target measurement checks when relevant
- a clean handoff from one phase to the next

Do not use this skill for:
- creating the original implementation plan
- teaching a topic from scratch
- reviewing whether a plan is correct
- vague summaries of a plan

Use the implementation-plan skill to create the plan first.
Use this skill after the plan exists and the next need is execution packaging.

## Writing Contract

### 1. Preserve the source plan's phase logic

Start from the source implementation plan.

If the source plan already has explicit phases:
- preserve the phase count
- preserve the order
- create exactly one output markdown file per phase

Do not silently:
- merge phases
- split phases
- reorder phases
- invent a different rollout shape

If the source plan does not clearly label phases:
- if the user specifies a phase count, use that count and explain the mapping
- otherwise ask once before inventing new phase boundaries

### 2. Each phase file must stand on its own

Another agent should be able to open one phase file and decide what to do without rereading the whole implementation plan.

Each phase file must make these things immediately visible:
- what this phase is about
- whether it can start now
- what blocks it
- what dependencies must be checked
- what target measurements matter
- what files, systems, or interfaces are likely affected
- how to verify success
- what happens next

Do not make the phase file depend on hidden context in earlier prose.

### 3. Readiness must be explicit

At the top of every phase file, include an execution snapshot that answers the start question directly.

Use one of these values:
- `Ready`
- `Blocked`
- `Unknown`

Use:
- `Ready` only when the required dependencies and entry conditions are confirmed
- `Blocked` when one or more required dependencies are clearly incomplete
- `Unknown` when the necessary evidence was not available or was not verified

Do not claim a phase can start based on assumption or optimism.

### 4. Dependencies must be checkable

A dependency is not complete just because the plan says it should happen earlier.

For every meaningful dependency, include:
- what the dependency is
- why it matters for this phase
- how to verify it is complete
- current status: `Done`, `Not Done`, or `Unknown`

Good dependency checks include concrete evidence like:
- a file exists
- a migration landed
- an interface changed
- a flag is present
- a command passes
- a benchmark was recorded
- a previous phase deliverable is visible in the repo or docs

Bad:
- depends on previous work

Better:
- depends on Phase 1 database migration being merged and applied; verify by checking `db/migrations/...` and the schema diff referenced in the source plan

### 5. Target measurements are first-class gates

If the source plan includes target measurements, thresholds, budgets, or success metrics, carry them into the relevant phase file.

For each one, include:
- the measurement
- how it should be measured
- the pass condition
- whether it is an entry gate or exit gate
- current status: `Met`, `Not Met`, or `Unknown`

Examples:
- latency threshold
- error-rate budget
- bundle-size target
- migration duration limit
- test coverage floor
- rollout percentage threshold
- memory ceiling
- benchmark delta

If no target measurement exists for a phase, say `None`.
Do not invent measurements just to fill the section.

### 6. Use current repo evidence when available

If the request is grounded in a real repo, inspect the repo to determine:
- whether dependencies are already complete
- whether target measurements have evidence
- what files and systems this phase likely touches
- whether the phase can actually start now

Prefer sources in this order:
1. current repo state
2. the source implementation plan
3. existing repo docs
4. official docs for libraries or tools involved
5. upstream source code or maintainer guidance when needed

If something was not verified from evidence, say so explicitly.

### 7. Separate phase purpose from execution detail

Every phase file must clearly separate:
- why this phase exists
- what is in scope
- what is out of scope
- implementation details
- execution steps
- verification
- handoff to the next phase

Do not blur intent, scope, and mechanics into one wall of text.

### 8. No cold paraphrase

Do not just restate the implementation plan.

Every section in the phase file must help an agent do one of these:
- decide whether to start
- understand what to build or change
- check whether prerequisites are satisfied
- verify whether the phase is done
- know what to hand off next

If a sentence does not help execution, gating, verification, or handoff, cut it.

### 9. Unknowns and assumptions must stay visible

When the source plan or repo does not provide enough information, do not guess.

Mark unclear points as:
- `Confirmed`
- `Inferred`
- `Unknown`

Use these labels where they materially affect readiness, dependency checks, measurements, or verification.

Missing evidence is not a minor detail.
Missing evidence directly affects whether a phase is truly startable.

### 10. End with a real handoff

Each phase file must end by making the next step obvious.

That means:
- name the next phase
- state what this phase must deliver before the next one can begin
- list what becomes unblocked
- note any artifacts the next phase will rely on

If it is the final phase, say that clearly and replace the handoff with final validation or rollout follow-through.

## Required Output

Produce:
1. a short phase-to-file mapping
2. exactly one markdown file per phase

Use zero-padded filenames by default:

- `01-<phase-slug>.md`
- `02-<phase-slug>.md`
- `03-<phase-slug>.md`

If the user asks for a different naming convention, follow that instead.

## Required Structure For Each Phase File

Use this structure unless the user asks for a different format:

1. Phase Title
2. Execution Snapshot
3. Why This Phase Exists
4. Start Criteria
5. Dependencies And How To Check Them
6. Target Measurements And Gates
7. Scope
8. Out Of Scope
9. Implementation Details
10. Execution Checklist
11. Files And Systems Likely Affected
12. Verification
13. Done Criteria
14. Handoff To Next Phase
15. Open Questions Or Blockers
16. Sources

## Section Rules

### Phase Title

Use a clear title that matches the source implementation plan.

Include:
- phase number
- short phase name
- source plan reference when useful

### Execution Snapshot

This section should let an agent answer "can I start?" in under 30 seconds.

Include:
- phase number
- source plan
- readiness status: `Ready`, `Blocked`, or `Unknown`
- primary deliverable
- blocking dependencies
- target measurements summary
- next phase

### Why This Phase Exists

Explain the purpose of this phase in the overall rollout or implementation path.

Keep it short.
Tie it directly to the source plan's logic.

### Start Criteria

List the conditions that must be true before execution starts.

Be concrete.
This is where phase readiness becomes operational rather than abstract.

### Dependencies And How To Check Them

For each dependency, include:
- dependency
- why it matters
- how to verify it
- status

Do not leave dependencies as vague references to earlier work.

### Target Measurements And Gates

Differentiate:
- entry gates
- exit gates

For each measurement, include:
- what is measured
- threshold or success condition
- measurement method
- current evidence
- status

### Scope

State what work belongs in this phase.

This should be specific enough that an agent knows what to do and what not to pick up yet.

### Out Of Scope

State what should not be done in this phase even if it is related.

This prevents phases from expanding into each other.

### Implementation Details

Include the real technical details that matter:
- files to change
- systems involved
- contracts or interfaces affected
- migration steps
- feature flags
- rollout sequencing
- data or schema implications
- dependency order inside the phase

If commands or checks are known, include them.

### Execution Checklist

Use an ordered checklist of concrete tasks.

Each item should be phrased so another agent can execute it.

Bad:
- handle backend changes

Better:
- add `X` field to `Y` response in `server/api/...`
- update `client/...` to consume the new shape
- add migration `...`
- verify flag wiring in `...`

### Files And Systems Likely Affected

List the likely touch points.

This should help the next agent orient quickly in the repo.

### Verification

Include:
- commands to run
- tests to run
- behaviors to check
- measurements to re-check
- regression checks
- success signals

Do not write vague verification like:
- test it
- make sure it works

### Done Criteria

State what must be true before the phase counts as complete.

Use concrete deliverables and evidence.

Examples:
- migration merged and applied
- tests pass
- flag exists and is wired
- benchmark recorded and within threshold
- docs updated
- downstream phase unblocked

### Handoff To Next Phase

State:
- the next phase
- what artifact or state it depends on
- what exactly becomes unblocked
- what should be picked up next

This section should feel like a baton pass.

### Open Questions Or Blockers

List missing information, external decisions, or unresolved dependencies.

If there are none, say `None`.

### Sources

Cite:
- source implementation plan sections
- repo files
- docs
- upstream source or official docs when relevant

## Execution Rules

- Prefer the smallest correct phase packet.
- Keep each phase file self-contained.
- Preserve the source plan's sequencing logic.
- Use current repo evidence when deciding readiness.
- Make verification as concrete as implementation.
- Separate required work from optional follow-up.
- If a phase can run in parallel with another, say so explicitly and state the constraint.
- If the source plan includes a rollback or recovery path relevant to the phase, carry it into that phase's implementation details or verification.
- If a dependency or measurement cannot be checked from available evidence, mark it `Unknown` instead of guessing.

## Banned Failure Modes

Do not:
- paraphrase the implementation plan without making it executable
- claim `Ready` without evidence
- use vague dependencies like "previous work complete"
- omit how a dependency should be checked
- invent metrics, thresholds, or pass conditions
- hide missing evidence
- merge multiple phases into one file without approval
- omit out-of-scope boundaries
- omit verification
- omit done criteria
- omit the next-phase handoff
- write phase docs that only make sense if someone already remembers the full plan

## Final Quality Check

Before finishing, verify:
- there is exactly one markdown file per phase
- phase order matches the source plan
- every phase file has a readiness status
- every dependency has a verification method
- every measurement has a threshold or an explicit `None`
- every phase has scope and out-of-scope boundaries
- implementation details are concrete
- verification is concrete
- done criteria are concrete
- handoff to the next phase is explicit
- unknowns are labeled instead of assumed
- another agent could open one file and start work or explain why it is blocked

## Output Expectation

The finished output should feel like this:
- I know what this phase is for
- I know whether I can start
- I know what I need to check first
- I know what exact work belongs here
- I know how to prove the phase is done
- I know what the next phase will need
