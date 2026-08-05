---
id: 90
title: motte merge — fold a duplicate issue into another
state: Done
assignee: claude
labels: [cli, core]
created: 2026-08-05T15:49:58Z
updated: 2026-08-05T18:14:40Z
---

## Description

Two agents file the same work, which happens for the same reason two branches mint the same id: nobody is coordinating. `renumber` repairs the id collision; nothing repairs the content one.

Merging should move the notes and children over, record the blockers, and leave a tombstone so the abandoned number still resolves — the same shape prune already uses, for the same reason: a reference in a commit message must not become a dead end.

## Plan

1. `motte merge <from> <into>` moves notes, children and blockers, then tombstones the source
2. Refuse when the two are related — merging a parent into its own child is a mistake, not a request
3. `--dry-run` explains what would move
4. `motte show <merged-ref>` follows the tombstone to the survivor rather than reporting nothing

## Notes

### 2026-08-05T18:14:40Z — Christopher Vachon (user)

Built as planned, with three additions the plan did not name.

The refusal set grew. Beyond parent/child in either direction, planMerge also refuses when rewriting a dependent's blocker onto the survivor would close a dependency loop — #3 waits on the duplicate, the survivor waits on #3, and afterwards those two wait on each other. IssueStore.update already caught that, but only halfway through, with the survivor written and the duplicate still on disk. Refusing in the plan is what keeps a merge all-or-nothing.

Every other command still refuses a merged number, but the refusal now says where it went ('#0090 was merged into #0042 — try that'). Refusing silently wasted the tombstone. Only show resolves through it, so 'motte move 90 done' cannot act on #0042 by accident.

The survivor inherits the duplicate's parent only when it had none of its own, so a merge never moves an issue out of the epic it was planned under. State and assignee are left alone — which of two duplicates is being worked on is a judgement claim and move already express.

Also exposed as the merge_issues MCP tool, since agents are what file duplicates in the first place, and the server instructions now say to use it rather than closing a duplicate as Done.
