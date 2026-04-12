---
name: review-verification
description: Produce findings-first technical reviews that verify claims, call out unsupported assumptions, and use detailed source-backed reasoning instead of generic summaries.
compatibility: opencode
metadata:
  audience: engineers
  style: review
---

# Review and Verification Skill

## What I do

Use this skill when the user wants an audit, critique, verification pass, claim check, or review.

Examples:
- review a plan
- verify whether a proposed migration is correct
- audit a design or architecture note
- check whether a technical claim is actually supported
- inspect whether a proposed recommendation matches the codebase

The goal is not to restate the document.
The goal is to find what is wrong, risky, unsupported, misleading, or missing, and to prove that assessment with evidence.

This skill should produce writing that is:
- findings-first
- evidence-first
- detailed
- tightly reasoned
- source-backed

## When to use me

Use this skill when the user wants:
- a review
- a critique
- a verification pass
- an evidence check
- a source check
- a risk and correctness assessment

Do not use this skill for teaching a topic from scratch or for writing a forward-looking implementation plan.

## Writing Contract

### 1. Findings first

Do not start with a summary.
Do not start with praise.
Do not start with a high-level overview.

Start with the findings.

The review must read like a justified verdict, not like a loose set of impressions.

At the top, make these explicit:
- what is being reviewed
- what standard or question it is being reviewed against
- what evidence was checked

### 2. Keep the detail, but make it serve the verdict

This skill should be detailed.

But detail must stay attached to a finding.

For each finding, do this in order:
1. state the claim or decision being reviewed
2. state the problem
3. show the evidence
4. explain the reasoning from evidence to conclusion
5. explain the impact
6. explain what should change
7. attach sources

Do not include technical detail unless it supports or refines a finding.

### 3. Explain jargon on first use

If the review needs technical terms, define them in plain language the first time they appear.

Examples:
- invalidation
- duplicate module instance
- race window
- blast radius
- eventual consistency
- stale cache

If you use a technical term, immediately answer: what does this mean here, in practical terms?

### 4. Prefer plain words over mystical wording

Avoid phrases like:
- semantic mismatch
- topology-sensitive issue
- coherence problem
- fragile interaction surface

Unless the term is truly necessary.
If you use it, explain it immediately and concretely.

### 5. No cold facts

Do not include a fact just because it is relevant to the area.

Only include it if it does at least one of these:
- proves a finding
- weakens a claim
- shows a missing step
- exposes a risk
- clarifies uncertainty
- shows why a recommendation does or does not hold

### 6. Tie claims to evidence

Every finding needs evidence.

Prefer sources in this order:
1. current repo code
2. source code of the dependency or tool in question
3. official docs
4. specs or standards
5. maintainer comments or issue threads when needed

If something could not be verified, say so explicitly.
Missing evidence is itself a useful review finding.

### 7. Distinguish certainty levels

For each finding, note whether it is:
- Confirmed from code, docs, or source
- Inferred from available evidence
- Unverified because the necessary source was not checked or does not exist

Do not blur these together.

### 8. Tight reasoning only

Do not write review comments that merely sound smart.

Prefer reasoning like:
- the plan assumes X
- but the code or docs show Y
- therefore the recommendation is unsupported, incomplete, or wrong

Do not stop at "this feels risky" when you can show why.

### 9. Every section must answer "so what?"

At the end of each finding or section, answer:
- why does this matter?
- what could break?
- what should change?

If the point does not affect correctness, risk, confidence, or scope, it is probably not worth including.

## Required Structure

Use this structure:

1. Findings
2. Open questions
3. What is solid
4. Suggested corrections
5. Sources

## Findings Rules

### Findings come first

List findings before any summary.

### Order by severity

Use severity labels:
- High
- Medium
- Low

### Each finding must include

- the claim, recommendation, or design choice being reviewed
- why it is a problem
- evidence
- the reasoning from evidence to conclusion
- impact
- what should change
- source reference

### Evidence quality must be explicit

For each finding, mark the evidence as:
- Confirmed
- Inferred
- Unverified

## What to Look For

Check for:
- unexplained jargon
- unsupported technical claims
- incorrect assumptions about tool or library behavior
- recommendations that do not follow from the evidence
- missing migration steps
- missing rollback or verification steps
- examples that mislead or oversimplify
- architecture that does not match the current codebase
- source sections that are weak, vague, or missing

## Good Review Behavior

Bad:
- this looks solid overall

Better:
- Medium: the document recommends `preserveSymlinks`, but it does not show the exact failure mode in this repo layout or cite Vite's relevant behavior. The recommendation may be right, but as written it is under-justified.

Then include evidence.

## If There Are No Major Findings

If no major issues are found, state that explicitly.

Still include:
- residual risks
- what was not verified
- any assumptions the document depends on

"No major findings" is allowed.
"Looks good" without evidence is not.

## Banned Failure Modes

Do not:
- summarize before listing findings
- make findings without evidence
- confuse unclear with wrong
- confuse risky with incorrect
- present generic praise as analysis
- hide unsupported claims behind confident language
- treat missing sources as a minor style issue when they affect correctness

## Final Quality Check

Before finishing, verify:
- findings come first
- each finding has severity and evidence quality
- each finding shows the reasoning from evidence to impact
- unsupported claims are explicitly called out
- missing sources are treated as real review issues when they matter
- the review distinguishes confirmed problems from inferred concerns

## Output Expectation

The finished review should feel like this:
- here is the exact claim being tested
- here is the evidence
- here is why the claim does or does not hold
- here is the severity
- here is what should change
