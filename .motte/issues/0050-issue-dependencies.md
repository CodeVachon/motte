---
id: 50
title: Issue dependencies
state: Todo
labels: [core, dx]
created: 2026-07-29T18:55:16Z
updated: 2026-07-29T18:55:17Z
---

## Description

A way to record that one issue is blocked by another, across the hierarchy.

Today the only relationship is parent/child, which is a tree. Dependencies are a DAG: #0047 sits under #0046 but #0004 also depends on it. The tree cannot express that, so real prerequisites are currently written as prose inside plan steps where nothing can query them.

The payoff is not the relation itself, it is the query it enables — see #0051.

## Plan

1. blockedBy: [ids] in frontmatter (#0052)
2. Cycle detection, separate from the parent-cycle check (#0053)
3. Readiness query and reporting (#0051)
4. Decide the relationship to the Blocked state — see the note on this issue

## Notes

### 2026-07-29T18:55:17Z — claude (agent)

On the overlap with the Blocked state, which this project's own config already has.

Recommendation: keep both, with a clear division. blockedBy is structural and machine-checkable — it points at another issue and drives readiness. The Blocked state stays for blockers that are not issues at all: waiting on a vendor, a decision, an access request. Those are real and the backlog should not be forced to invent a placeholder issue for them.

What must not happen is deriving the Blocked state from blockedBy. That would make state a computed field in a file people hand-edit, and the two would disagree the first time someone set one without the other. Readiness is computed and never written; state stays authored.
