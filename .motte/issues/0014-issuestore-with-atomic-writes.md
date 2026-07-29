---
id: 14
title: IssueStore with atomic writes
state: Done
parent: 2
labels: [core]
created: 2026-07-29T11:36:00Z
updated: 2026-07-29T16:04:08Z
---

## Description

The single writer path for every surface: `list`, `get`, `create`, `update`, `addNote`,
`setState`, `setParent`, `archive`.

All writes go temp-file-then-rename so a crash mid-write cannot leave a truncated issue on disk.
Reads are cached with mtime invalidation, since agents and the web UI both poll.

## Plan

1. Directory scan and parse, cached by mtime
2. Atomic write helper
3. Mutation methods, each bumping `updated`
4. Rename the file when the title changes, keeping the id prefix
