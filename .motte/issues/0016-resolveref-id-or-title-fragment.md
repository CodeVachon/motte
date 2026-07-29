---
id: 16
title: resolveRef — id or title fragment
state: Done
parent: 2
labels: [core, cli]
created: 2026-07-29T11:38:00Z
updated: 2026-07-29T16:04:09Z
---

## Description

Every command that takes an issue should accept either a number or a piece of the title, so
`motte assign schema atlas` works without looking up an id first.

Numeric input resolves as an id. Anything else is a case-insensitive substring match on the title,
erroring with the candidate list when the match is ambiguous.

## Plan

1. `resolveRef(input)` returning an issue or a typed error
2. Ambiguous-match error listing the candidates with their ids
3. Not-found error suggesting the closest title
