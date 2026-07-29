---
id: 33
title: Bun.serve API and SSE watcher
state: Todo
parent: 6
labels: [web]
created: 2026-07-29T11:55:00Z
updated: 2026-07-29T11:55:00Z
---

## Description

`Bun.serve()` bound to `127.0.0.1` with no auth, exposing the embedded SPA and a JSON API over
core. An SSE endpoint driven by the file watcher pushes changes, so the browser updates when an
agent writes to disk.

## Plan

1. Static handler for the embedded assets
2. `GET/POST /api/issues`, `PATCH /api/issues/:id`, `POST /api/issues/:id/notes`, `GET /api/config`
3. `GET /api/events` SSE fed by `core/watch`
4. `--port` and `--open`
