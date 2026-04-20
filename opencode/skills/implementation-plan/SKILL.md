---
name: implementation-plan
description: Write detailed, source-backed implementation plans with a clear throughline from the current problem to a justified recommendation, exact steps, risks, and verification.
compatibility: opencode
metadata:
  audience: engineers
  style: planning
---

# Implementation Plan Skill

## What I do

Use this skill when the user wants to build, change, migrate, integrate, or refactor something.

Examples:
- migrate a repo to a new workspace model
- add a feature or subsystem
- change a deployment flow
- replace a dependency
- restructure a build pipeline
- refactor an existing design into a new shape

The goal is not to list many facts about the problem space.
The goal is to produce a plan that is decision-ready and execution-ready, with a clear chain from the current problem to the recommended path.

This skill should produce writing that is:
- detailed
- concrete
- tightly reasoned
- implementation-aware
- source-backed

## When to use me

Use this skill when the user wants:
- a plan
- a migration guide
- an implementation strategy
- an architecture recommendation with rollout steps
- a decision document that explains what to do and why

Do not use this skill for pure deep explanation or pure review. Use the deep-dive or review skill for those.

## Writing Contract

### 1. Throughline first

The plan must read like a justified argument.

At the top, make these explicit:
- the starting point: what the current system or repo looks like now
- the driving problem: what is broken, risky, awkward, or constrained
- the finish line: what successful end state the plan is aiming for

Every section must help answer one question:
- why this recommendation follows from the current state and constraints

If a section contains true facts but does not affect the decision, cut it or move it to an appendix.

### 2. Keep the detail, but make it serve the decision

This skill should be detailed.

But detail must stay attached to the plan's logic.

For each important section, do this in order:
1. state the question the section answers
2. give the short answer
3. show one concrete example from the real repo or system
4. explain the mechanics or behavior that matter
5. explain why this changes the plan or recommendation
6. list risks or tradeoffs
7. attach sources

Do not front-load implementation detail before the reader knows why it matters.

### 3. Explain jargon on first use

If the plan needs technical terms, define them in plain language the first time they appear.

Examples:
- symlink
- hoisting
- file identity
- dedupe
- hydration
- canary rollout
- blast radius

If a term is abstract, immediately pair it with a concrete example.

### 4. Prefer plain words over mystical wording

Avoid phrases like:
- coherent graph
- semantic migration
- identity boundary
- topology-sensitive behavior
- robust pipeline

Unless the term is truly necessary.
If you use it, explain it immediately in plain English.

### 5. Use a running example of the actual change

Prefer one running example through the document.

Good examples:
- one package import path through the workspace
- one request through the deployment path
- one file moving through the build pipeline
- one user action through the feature flow

Reuse that example so the plan feels connected instead of modular.

### 6. Build intuition before formal mechanics when needed

If the plan depends on behavior that can feel magical, easy to misunderstand, or easy to misimplement, add a short intuition section before the exact implementation mechanics.

Use this for topics like:
- caching or invalidation
- reactivity or state synchronization
- SSR or hydration
- concurrency, queueing, or background jobs
- bundler, resolver, or build behavior
- ranking, search, or recommendation flows
- browser rendering or layout behavior
- auth, token, or session flows

Keep it short.

Use:
- one plain-English explanation
- one tiny example or one end-to-end flow
- one direct tie back to why this changes the recommendation

The goal is not to turn the plan into a tutorial.
The goal is to make the recommendation legible before the detailed steps begin.

### 7. Use visuals when they reduce ambiguity

If the plan spans multiple subsystems, request flows, state transitions, rollout phases, dependency edges, or ownership boundaries, include at least one Mermaid diagram.

Prefer simple diagram types:
- `flowchart` for architecture, dependencies, or rollout order
- `sequenceDiagram` for request or interaction flow
- `stateDiagram-v2` for lifecycle or state transitions
- `graph TD` for subsystem or component relationships

The diagram must:
- match the prose exactly
- use the same names as the surrounding sections
- clarify the recommendation instead of decorating the document
- stay small enough to read quickly

If a diagram would not make the plan clearer, omit it.
Do not force Mermaid into simple plans.

### 8. UI plans need rough visual artifacts

If the plan changes UI structure, screen layout, interaction flow, or component composition, include rough visual artifacts.

Include:
- a simple ASCII mock of the changed screen, region, or flow
- a component map or component relationship diagram
- key interaction or state boundaries when they affect implementation
- responsive differences when they materially change the work

Keep these rough and implementation-oriented.
Do not produce polished design fiction.

The visuals should help answer:
- what the user sees
- what components exist
- where state lives
- what data or API dependencies touch the UI
- what likely needs to be built first

### 9. No cold facts

Do not include a fact just because it is relevant to the area.

Only include it if it does at least one of these:
- explains the current problem
- changes the recommendation
- explains a migration step
- explains a risk
- explains a failure mode
- explains how to verify success

### 10. Tie claims to evidence

Every non-obvious claim needs a source.

Prefer sources in this order:
1. current repo code
2. source code of the dependency or tool in question
3. official docs
4. specs or standards
5. high-quality technical articles or maintainer comments when needed

Do not rely on general confidence or memory when the plan depends on exact tool behavior.

### 11. Distinguish certainty levels

Explicitly label claims when needed as:
- Confirmed
- Inferred
- Speculative

If some part of the plan depends on an assumption, call that out instead of quietly embedding it.

### 12. End each section with "why this changes the plan"

At the end of each important section, answer:
- so what?
- why does this matter for the recommendation?

If the section does not affect the recommendation, implementation order, or risk model, it is probably not pulling its weight.

## Required Structure

Use this structure unless there is a strong reason not to:

1. Goal
2. Starting point, driving problem, and finish line
3. Constraints and assumptions
4. Current state
5. What is actually causing the problem
6. Intuition and mental model of the change (if needed)
7. Options considered
8. Recommended approach
9. Visual overview (if needed)
10. Step-by-step implementation plan
11. UI sketch and component map (UI plans only)
12. Risks and failure modes
13. Verification plan
14. Rollback or recovery plan
15. Sources

## Section Rules

### Goal
State the desired end state clearly.

### Starting point, driving problem, and finish line
Make the narrative explicit:
- where we are now
- what is wrong with that
- where we need to end up

### Constraints and assumptions
List real technical, operational, and organizational constraints.
Label assumptions explicitly.

### Current state
Ground the plan in the actual codebase or system today.
Cite file paths, commands, runtime behavior, or docs.

### What is actually causing the problem
Do not jump to fixes before showing the cause.

### Intuition and mental model of the change
If the plan depends on tricky system behavior, explain the plain-English model before the detailed mechanics.
Use one concrete flow or tiny example.
End by explaining why this changes the recommendation.

### Options considered
For each real option, include:
- what it is
- what it changes
- pros
- cons
- when it makes sense
- why it is rejected or accepted

### Recommended approach
State the recommendation clearly and show why it is the best tradeoff.

### Visual overview
When the recommendation involves multiple moving parts, include a Mermaid diagram that shows the system shape, flow, rollout, or dependency structure.
Explain what the diagram is showing and why it matters.
Do not let the diagram stand alone without prose.

### Step-by-step implementation plan
Be concrete.
Include:
- files to change
- systems affected
- sequence of work
- dependency order between steps
- migration order

### UI sketch and component map
For UI-related plans, include:
- a rough ASCII mock of the changed interface
- a component map or hierarchy
- key interaction states when relevant
- responsive differences when relevant

Tie the mock and component map back to the implementation steps.
If UI details depend on assumptions, label them explicitly.

### Risks and failure modes
Name realistic breakage modes.
Do not only list generic risks like regressions or complexity.

### Verification plan
Include:
- commands to run
- behaviors to verify
- success criteria
- regression checks

### Rollback or recovery plan
Explain how to back out or reduce blast radius if the plan goes wrong.

## Example Rule

Whenever the plan depends on tricky system behavior, include a concrete example.

Bad:
- package resolution crosses symlink boundaries

Better:
- in a pnpm workspace, `node_modules/@scope/pkg` is often a symlink that points to another folder on disk. A tool may see either the import path or the real target path. If it treats those as different locations, it can load the same package twice or track file changes inconsistently.

Then explain exactly why that matters for this repo shape.

## Planning Rules

- Prefer the smallest correct plan.
- Separate required work from optional polish.
- Do not recommend extra infrastructure unless the evidence justifies it.
- If the recommendation depends on a version-specific behavior, say so.
- Use file-level and subsystem-level references whenever possible.
- Make the verification plan as concrete as the implementation plan.
- Use intuition sections only when they help the reader understand a tricky recommendation.
- Use Mermaid only when it removes ambiguity.
- If Mermaid is included, the diagram names must match the prose exactly.
- If a UI sketch is included, it must map to real components, routes, state owners, or APIs.
- Keep visuals rough, compact, and implementation-oriented.

## Banned Failure Modes

Do not:
- use unexplained jargon
- recommend a solution before explaining the cause
- drop into exact mechanics before making the tricky behavior understandable
- present options without real tradeoffs
- make strong tool-behavior claims without sources
- include decorative Mermaid that does not change understanding
- include Mermaid that disagrees with the prose
- produce a UI mock without mapping it to components or implementation steps
- ignore responsive or state implications for UI work when they affect scope
- confuse preference with fact
- hide assumptions
- write a plan that sounds complete but omits verification or rollback

## Final Quality Check

Before finishing, verify:
- the starting point, driving problem, and finish line are explicit
- the recommendation clearly follows from the constraints and current state
- tricky system behavior gets a short intuition section before the detailed plan when needed
- every tricky claim has a source
- Mermaid is used when it materially clarifies the plan, and omitted when it would be ceremony
- any Mermaid names match the prose exactly
- every important section explains why it changes the plan
- UI-related plans include a rough ASCII mock and component map when structure or flow changes matter
- visuals help explain implementation order and ownership, not just the end state
- required work and optional work are clearly separated
- verification and rollback are concrete enough to act on

## Output Expectation

The finished document should feel like this:
- here is the current situation
- here is the real cause of the problem
- here is the plain-English mental model before the tricky mechanics, when needed
- here are the realistic options
- here is why this one wins
- here is the system or UI shape visually when that makes the plan easier to follow
- here is the exact order to implement it
- here is how to know it worked
