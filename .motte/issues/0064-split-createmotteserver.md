---
id: 64
title: Split createMotteServer
state: Todo
parent: 67
labels: [mcp, health]
created: 2026-07-30T14:27:04Z
updated: 2026-07-30T14:39:52Z
---

## Description

createMotteServer is 525 lines — by a wide margin the largest function in the project. It registers twelve tools in one body, so every tool's schema, guard and handler shares one scope.

Found by fallow's unit-size analysis, which is one of the two largest penalties on the project health score.

## Plan

1. One module per tool group: reads, writes, breakdown
2. Keep the shared helpers (guard, open, author, issueJson) in one place they can all import
3. createMotteServer becomes registration only
4. The existing 26 server tests should pass untouched — if they need changing, the split changed behaviour
