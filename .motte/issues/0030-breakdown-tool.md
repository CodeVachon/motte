---
id: 30
title: breakdown tool
state: Done
parent: 5
labels: [mcp, agents]
created: 2026-07-29T11:52:00Z
updated: 2026-07-30T01:36:47Z
---

## Description

Create many child issues under one parent in a single call, so an agent can decompose an epic
without a round trip per child.

This is the tool that most directly serves the project's purpose: take a larger story and break it
into smaller trackable components.

## Plan

1. Accept a parent ref and an array of `{ title, description?, plan? }`
2. Allocate ids in one pass to avoid collisions within the batch
3. Return the created issues, and the parent's updated subtree progress

## Notes

### 2026-07-30T01:36:47Z — claude (agent)

Done. breakdown creates every child under a parent in one call, and can express the ordering between
them in the same call via blockedByIndex — positions within the batch, since the ids do not exist yet.
Dependencies are applied in a second pass once every child has a real id.

The whole batch is validated before anything is written, so a rejected breakdown never leaves a
half-built subtree. Three cases are rejected: a child depending on itself, a child depending on a later
position, and an index past the end of the list. Verified on a fresh project that all three leave the
issue count unchanged.

Ordering of those checks matters. Out-of-range was initially reported as "comes later in the list",
which is technically true but sends you looking at ordering instead of at a typo. Out-of-range is now
reported as out-of-range.

Children inherit the parent's labels by default, since a breakdown of a +core epic is almost always
+core work. inheritLabels: false opts out.

The return value includes the parent's updated subtree progress and which of the new children are
immediately ready, so an agent can go straight from breaking work down to starting it.
