---
id: 22
title: list, show, and tree
state: Done
parent: 3
labels: [cli]
created: 2026-07-29T11:44:00Z
updated: 2026-07-29T16:04:10Z
---

## Description

The read commands, each with a `--json` mode. Human output is coloured and aligned; `--json` is
stable and documented, because that is the interface agents without MCP will use.

## Plan

1. `list` with `--state`, `--parent`, `--assignee`, `--label`, `--tree`
2. `show <ref>` rendering description, plan, and notes
3. `tree [ref]` drawing the forest, or one subtree
4. `--json` on all three, shape asserted in tests
