---
id: 63
title: The dashboard, and non-TTY behaviour
state: Todo
parent: 60
labels: [cli, dx]
blockedBy: [62]
created: 2026-07-30T12:14:50Z
updated: 2026-07-30T12:14:50Z
---

## Description

Render a compact live view: progress, what is in flight and by whom, and a running stream of transitions as they happen.

Raw ANSI rather than a TUI framework — pulling in ink would mean React in the CLI, which is a lot of dependency for one command.

## Plan

1. Pinned summary plus a scrolling transition stream
2. Restore the terminal on exit, including on a crash or SIGINT — a corrupted terminal is worse than no dashboard
3. Handle resize
4. When stdout is not a terminal, print transitions as plain lines instead, so `motte watch | tee` still works
5. --interval for filesystems where watching is unreliable
