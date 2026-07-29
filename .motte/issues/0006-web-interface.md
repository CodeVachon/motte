---
id: 6
title: Web interface
state: Todo
labels: [web]
created: 2026-07-29T11:25:00Z
updated: 2026-07-29T11:25:00Z
---

## Description

`motte serve` runs a local, full read/write web UI: board, tree, issue detail, and progress
reports. Bound to `127.0.0.1` with no auth, because it is a local tool.

The SPA is built to static assets and embedded in the binary, so serving it needs no extra runtime
and works offline.

## Plan

1. Vite + React 19 + Tailwind 4 + shadcn scaffold
2. `Bun.serve()` JSON API over core, plus SSE fed by the file watcher
3. Board (drag to change state), Tree (drag to re-parent), Issue detail, Reports
4. Build step that inlines the built assets into the binary

## Notes

### 2026-07-29T11:25:00Z — claude (agent)

All writes go through core, so the web UI cannot drift from the CLI and MCP behaviour.
