---
id: 2
title: Issue format and core data layer
state: Done
labels: [core]
created: 2026-07-29T11:21:00Z
updated: 2026-08-05T13:17:20Z
---

## Description

`packages/core` is the single data layer that the CLI, the web API, and the MCP server all sit on
top of. It owns the on-disk format, config loading, the issue store, and the derived views (tree,
progress reports).

It must stay pure: no `yargs`, no `chalk`, no HTTP. That constraint is what lets three very
different surfaces share one implementation and one set of tests.

## Plan

1. zod schemas for frontmatter and the parsed issue
2. `parseIssueFile` / `formatIssueFile` with byte-exact round-tripping
3. Config discovery, `IssueStore`, id allocation, `resolveRef`
4. Derived views: tree, progress reports
5. Author resolution and a file watcher

## Notes

### 2026-07-29T11:21:00Z — claude (agent)

This is where the heaviest test coverage in the project belongs. Everything above it is a thin
adapter.

### 2026-08-05T13:17:20Z — claude (agent)

Every child has settled. The last one open was #0042, motte renumber — the repair half of deriving ids from a directory scan, which the ReadMe had been promising since 0.1.0 while the command did not exist. Closing on doctor's own prompting: the open-with-settled-children warning is what surfaced it.
