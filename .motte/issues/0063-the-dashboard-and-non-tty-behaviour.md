---
id: 63
title: The dashboard, and non-TTY behaviour
state: Done
parent: 60
labels: [cli, dx]
blockedBy: [62]
created: 2026-07-30T12:14:50Z
updated: 2026-08-05T14:29:09Z
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

## Notes

### 2026-08-05T14:29:08Z — claude (agent)

Built as five pieces: a pure frame builder, the loop with every dependency injected, and a thin command that supplies the real ones. That split is what made the interesting cases reachable from tests — a read that throws, a resize, a pipe instead of a terminal, and stopping actually stopping.

All five plan points done. Alternate screen buffer with the cursor hidden, restored on SIGINT, SIGTERM, exit, a closed pipe and an uncaught exception — a shell left in the alternate buffer is worse than no dashboard, so that guarantee has its own test and a mutation check. Resize redraws without re-reading the backlog. In a pipe it prints one line per change and no control sequences at all, so `motte watch | tee` works. --interval polls instead of watching, rather than as well: on a filesystem where watching is unreliable the point is to stop depending on it.

Verified in a real pseudo-terminal, because neither `script` nor a plain pipe can exercise the TTY path here: a Python openpty harness runs the dashboard, drives writes from outside, sends SIGINT and checks the bytes. Entered the alternate screen once, left it once, cursor hidden once and shown once, four frames drawn, exit 0. The rendered frame shows progress, in-flight with the assignee, and a stream of four transitions ending in the derived '#0002 ready' — the motivating case, one agent finishing a blocker letting another start.

One ordering bug the real run exposed: 'ready' has no timestamp, so it sorted first and printed above the change that caused it. Unstamped changes now sort after the stamped ones in a batch, since a consequence cannot precede its cause.
