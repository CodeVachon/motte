---
id: 13
title: Config discovery and validation
state: Done
parent: 2
labels: [core]
created: 2026-07-29T11:35:00Z
updated: 2026-07-29T16:04:08Z
---

## Description

Find `.motte.config.json` by walking up from the working directory the way git finds `.git`, so
commands work from any subdirectory. Validate with zod and apply defaults.

The `category` on each state (`unstarted`, `started`, `completed`, `cancelled`) is what lets
progress reports work without hardcoding state names.

## Plan

1. Upward search from cwd, stopping at the filesystem root
2. zod validation with a clear error naming the offending field
3. Defaults: Todo / In Progress / Done, `issuesDir: ".motte/issues"`
4. Reject a `defaultState` that is not in `states`
