---
id: 42
title: motte renumber
state: Done
parent: 2
labels: [core]
created: 2026-07-29T16:04:11Z
updated: 2026-08-05T13:16:59Z
---

## Description

Two branches can each mint the same issue number, because ids come from a directory scan rather than a counter. doctor detects the collision; renumber has to repair it.

## Plan

1. Detect duplicate ids
2. Reassign the later file to a fresh id
3. Rewrite any parent references pointing at the reassigned id
4. Rename the file to match

## Notes

### 2026-08-05T13:16:59Z — claude (agent)

Built as planned except for step 3, which I did not do and think should not be done. Rewriting a parent reference is a guess: when two files both claimed #7, a third issue saying parent: 7 meant one of them and nothing on disk records which. Those references are listed instead — they still point at whichever issue kept the number, so they are valid rather than dangling — and the command says plainly that a human has to settle them.

The rules that needed pinning down: earliest created keeps the number, filename breaks a tie so two people repairing the same merge get the same backlog, and new ids come from above the highest in use rather than filling gaps, so a renumber never re-uses a number that is already in a branch name or a commit message.

renumberFile is the only store mutator addressed by path rather than id, which it has to be — the only reason to call it is that require(id) cannot tell the two files apart. It deliberately does not go through write(), which finds the previous version by id and would delete the wrong file. It appends a note recording where the number came from; the event log cannot be reassigned, since both files recorded their history under the one id and those entries are already inseparable.

Verified by hand against a real collision: doctor went from exit 1 to clean, the later file was renamed 0007-branch-b.md → 0010-branch-b-work.md, created was preserved, and the ambiguous parent reference was reported rather than rewritten.
