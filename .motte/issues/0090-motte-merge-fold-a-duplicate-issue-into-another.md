---
id: 90
title: motte merge — fold a duplicate issue into another
state: Todo
labels: [cli, core]
created: 2026-08-05T15:49:58Z
updated: 2026-08-05T15:49:58Z
---

## Description

Two agents file the same work, which happens for the same reason two branches mint the same id: nobody is coordinating. `renumber` repairs the id collision; nothing repairs the content one.

Merging should move the notes and children over, record the blockers, and leave a tombstone so the abandoned number still resolves — the same shape prune already uses, for the same reason: a reference in a commit message must not become a dead end.

## Plan

1. `motte merge <from> <into>` moves notes, children and blockers, then tombstones the source
2. Refuse when the two are related — merging a parent into its own child is a mistake, not a request
3. `--dry-run` explains what would move
4. `motte show <merged-ref>` follows the tombstone to the survivor rather than reporting nothing
