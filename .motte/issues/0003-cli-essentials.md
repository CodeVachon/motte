---
id: 3
title: CLI essentials
state: Done
labels: [cli]
created: 2026-07-29T11:22:00Z
updated: 2026-08-04T21:27:23Z
---

## Description

The command surface that makes motte usable day to day, and the point at which this project stops
being edited by hand and starts being managed by its own tool.

Every read command must support `--json`. That is what makes the CLI usable by agents that are not
speaking MCP, and it is how the smoke tests assert behaviour.

## Plan

1. `init`, `add`, `list`, `show`
2. `move`, `note`, `assign`, `edit`
3. `status`, `tree`, `doctor`
4. Scripted smoke run against a temp dir, asserting on `--json` output

## Notes

### 2026-07-29T11:22:00Z — claude (agent)

Switchover point for dogfooding: once `motte list` reads this backlog, hand-editing stops and every
subsequent issue is created with motte itself.

### 2026-07-29T16:04:10Z — claude (agent)

init, add, list, show, edit, move, assign, note, status, tree and doctor all work, each with --json. Verified by hand against a scratch project. Still outstanding: committing that smoke run as an automated test.

### 2026-08-04T21:27:23Z — claude (agent)

Every child has settled: init, the everyday commands, list/show/tree, status, doctor, the smoke test, the EPIPE fix, the prune tests and the bare-motte fix. Closing it — doctor's new open-with-settled-children warning is what surfaced that it was still open.
