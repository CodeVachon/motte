---
id: 15
title: ID allocation and title slugs
state: Done
parent: 2
labels: [core]
created: 2026-07-29T11:37:00Z
updated: 2026-07-30T00:50:42Z
---

## Description

Next id is `max(existing) + 1`, derived by scanning the issues directory. No counter file, because
a counter would be a write-conflict on every single create.

The trade is that two branches can both mint the same id. `motte doctor` detects duplicates and
`motte renumber` repairs them.

## Plan

1. `nextId()` from a directory scan, correct across gaps
2. `slugify(title)` for the filename, zero-padded id prefix to four digits
3. `motte renumber` to reassign colliding ids and rewrite references

## Notes

### 2026-07-29T11:37:00Z — claude (agent)

This is the one place the "unique issue number" guarantee is best-effort rather than absolute. It is
the right trade for a small-project tool, but it needs to be documented in the ReadMe, not just
here.

### 2026-07-29T16:04:09Z — claude (agent)

nextId() from a directory scan and slugify()/issueFilename() are done and tested, including the gap case where an id is deleted and must not be reused. Still outstanding: the motte renumber command for repairing duplicate ids.

### 2026-07-30T00:50:42Z — claude (agent)

Closing. The remaining scope — motte renumber — was split into #0042 and is tracked there. nextId() from a directory scan and slugify()/issueFilename() are done and tested. Same bookkeeping slip as #0011: when work moves out of an issue into a new one, the original needs closing in the same breath.
