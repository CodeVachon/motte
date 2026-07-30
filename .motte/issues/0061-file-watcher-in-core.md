---
id: 61
title: File watcher in core
state: Todo
parent: 60
labels: [cli, dx]
created: 2026-07-30T12:14:50Z
updated: 2026-07-30T12:14:50Z
---

## Description

Watch the issues directory and emit change events, coalescing the burst that a single write produces.

Atomic writes are temp-file-then-rename, so one logical change fires several filesystem events. Without coalescing the dashboard would flicker and re-render several times per edit.

## Plan

1. fs.watch wrapper in core, returning an unsubscribe function
2. Coalesce events within a short window into one change notification
3. Tolerate the directory being deleted and recreated
4. Shared with motte serve (#0033), which needs the same thing for its SSE endpoint
