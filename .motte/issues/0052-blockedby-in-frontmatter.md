---
id: 52
title: blockedBy in frontmatter
state: Todo
parent: 50
labels: [core]
created: 2026-07-29T18:55:17Z
updated: 2026-07-29T18:55:17Z
---

## Description

Store only the blockedBy direction. The inverse — what an issue blocks — is derived at read time rather than stored, because storing both sides is a denormalisation that will drift the moment one file is hand-edited.

blockedBy is also the direction you author from: you are editing the blocked issue when you discover the prerequisite.

## Plan

1. blockedBy: z.array(positive int).optional() in the frontmatter schema
2. Emit as a flow array after labels, matching how labels already serialise
3. blocks(id) derived in core
4. motte block <ref> <blocker> and motte unblock <ref> <blocker>
5. Round-trip tests, including the empty-array-drops-the-field case

## Notes

### 2026-07-29T18:55:17Z — claude (agent)

Worth stating the near-miss: the first instinct is to store blocks and blockedBy on both issues so either file reads self-contained. Do not. These files are hand-edited and merged by git, so a two-sided relation will drift, and then two files disagree about reality with no tiebreaker. One direction stored, the inverse derived.
