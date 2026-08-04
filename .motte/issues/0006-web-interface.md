---
id: 6
title: Web interface
state: Done
labels: [web]
created: 2026-07-29T11:25:00Z
updated: 2026-08-04T17:44:54Z
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

### 2026-08-04T17:44:54Z — claude (agent)

All four children are done: the scaffold (#0032), the API and SSE watcher (#0033), the four views (#0034), and embedding into the binary (#0035). The interface works from an installed binary with no flags. Two follow-ups remain open under this epic and neither blocks use: #0079, automated tests for the views, which is the real gap since their only verification so far is a Playwright pass driven by hand; and #0080, the UI not saying when it has lost the server.
