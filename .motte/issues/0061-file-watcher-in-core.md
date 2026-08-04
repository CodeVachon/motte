---
id: 61
title: File watcher in core
state: Done
parent: 60
labels: [cli, dx]
created: 2026-07-30T12:14:50Z
updated: 2026-08-04T17:36:23Z
---

## Description

Watch the issues directory and emit change events, coalescing the burst that a single write produces.

Atomic writes are temp-file-then-rename, so one logical change fires several filesystem events. Without coalescing the dashboard would flicker and re-render several times per edit.

## Plan

1. fs.watch wrapper in core, returning an unsubscribe function
2. Coalesce events within a short window into one change notification
3. Tolerate the directory being deleted and recreated
4. Shared with motte serve (#0033), which needs the same thing for its SSE endpoint

## Notes

### 2026-08-04T17:36:23Z — claude (agent)

Already done — landed under #0033 rather than here, and I did not notice at the time.

core/watch.ts is exactly what this issue asks for: an fs.watch wrapper returning an unsubscribe function,
coalescing the burst that one atomic write produces, and tolerating directories that do not exist. This
issue's own plan step 4 anticipated the overlap: "Shared with motte serve (#0033), which needs the same thing
for its SSE endpoint." That is what happened, in the other direction.

Seventeen tests cover it. Most deliver directory events through an injected factory, because driving it
through a real filesystem made the assertions depend on how promptly macOS chooses to notice a write — see
the note on #0033.

Closing it here rather than leaving it to be discovered a third time. #0062, which it blocks, is unaffected:
transition detection is still open, and it now has a watcher to build on.
