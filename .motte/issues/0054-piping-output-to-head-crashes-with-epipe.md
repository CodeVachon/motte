---
id: 54
title: Piping output to head crashes with EPIPE
state: Done
parent: 3
labels: [cli, bug]
created: 2026-07-29T19:42:12Z
updated: 2026-07-29T19:43:19Z
---

## Description

Any command piped into something that closes the pipe early — `motte status | head`, or quitting `less` before the end — dies with an unhandled EPIPE and dumps a Bun stack trace.

Closing a pipe early is normal shell behaviour, not an error. Every well-behaved CLI exits quietly.

## Plan

1. Treat EPIPE as a clean exit rather than a crash
2. Cover both the synchronous write throw and the async stream error
3. Exit 0 — the reader chose to stop reading, nothing failed
4. Verify across every command that writes multi-line output

## Notes

### 2026-07-29T19:43:19Z — claude (agent)

Fixed. A closed pipe can surface two ways depending on where the reader went away: as a thrown write, or as an error event on the stream. Both are now swallowed, and both exit 0 — the reader chose to stop, nothing failed.

Found by dogfooding, not by testing: I ran `motte status | head -8` while closing out #0047 and got a Bun stack trace. Verified across status, list, list --tree, tree, ready, ready --blocked, show and doctor, plus a reader that exits immediately and one that closes mid-JSON. Real errors still report normally.
