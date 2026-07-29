---
id: 19
title: Author resolution for notes
state: Done
parent: 2
labels: [core, agents]
created: 2026-07-29T11:41:00Z
updated: 2026-07-29T16:04:09Z
---

## Description

Notes are authored by either the agent or the git user, and the file records which. Resolution
order: explicit flag, then `MOTTE_AUTHOR` / `MOTTE_AGENT`, then MCP client identity, then
`git config user.name`, then `$USER`.

## Plan

1. `resolveAuthor(opts)` returning `{ name, type }`
2. CLI defaults to the git user; MCP defaults to the agent
3. Fall back gracefully when git is absent or the repo has no configured user
