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

### 6. No cold facts

Do not include a fact just because it is relevant to the area.

Only include it if it does at least one of these:
- explains the current problem
- changes the recommendation
- explains a migration step
- explains a risk
- explains a failure mode
- explains how to verify success

### 7. Tie claims to evidence

Every non-obvious claim needs a source.

Prefer sources in this order:
1. current repo code
2. source code of the dependency or tool in question
3. official docs
4. specs or standards
5. high-quality technical articles or maintainer comments when needed

Do not rely on general confidence or memory when the plan depends on exact tool behavior.

### 8. Distinguish certainty levels

Explicitly label claims when needed as:
- Confirmed
- Inferred
- Speculative

If some part of the plan depends on an assumption, call that out instead of quietly embedding it.

### 9. End each section with "why this changes the plan"

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
6. Options considered
7. Recommended approach
8. Step-by-step implementation plan
9. Risks and failure modes
10. Verification plan
11. Rollback or recovery plan
12. Sources

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

### Step-by-step implementation plan
Be concrete.
Include:
- files to change
- systems affected
- sequence of work
- dependency order between steps
- migration order

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

## Banned Failure Modes

Do not:
- use unexplained jargon
- recommend a solution before explaining the cause
- present options without real tradeoffs
- make strong tool-behavior claims without sources
- confuse preference with fact
- hide assumptions
- write a plan that sounds complete but omits verification or rollback

## Final Quality Check

Before finishing, verify:
- the starting point, driving problem, and finish line are explicit
- the recommendation clearly follows from the constraints and current state
- every tricky claim has a source
- every important section explains why it changes the plan
- required work and optional work are clearly separated
- verification and rollback are concrete enough to act on

## Output Expectation

The finished document should feel like this:
- here is the current situation
- here is the real cause of the problem
- here are the realistic options
- here is why this one wins
- here is the exact order to implement it
- here is how to know it worked
