---
id: 91
title: watch --all, across every registered project
state: Done
assignee: claude
labels: [cli, dx]
created: 2026-08-05T15:49:58Z
updated: 2026-08-05T19:30:29Z
---

## Description

The dashboard watches one project. The registry now knows about all of them, and the case that motivated watching — several agents at once — is exactly the case where they are working in more than one repository.

## Plan

1. Watch every registered project, dropping the ones that cannot be read
2. Each change line names its project
3. The pinned summary becomes the cross-project total, per project underneath
4. Bound the watchers: a machine with forty registered projects should not open forty watches without saying so

## Notes

### 2026-08-05T19:30:29Z — claude (agent)

--all does all four things the plan named, and the interesting part was what generalising exposed.

The loop and the renderer now take a list of sources rather than one, and one project goes down the same path — two renderers that had to agree would have drifted. That was the right call for a second reason the plan did not anticipate: each change carries its own project's config, so a project that names its states Backlog/Doing/Shipped renders from its own palette. A single ambient config would have coloured other projects' changes wrongly and silently. The cross-project total is summed from each project's own report for the same reason: only its config knows which of its states counts as done.

Two bugs found by reading real output rather than by the tests.

The frame only ever trimmed the change stream, on the stated grounds that scrolling its own header away would be worse than showing less history — but a summary taller than the window overflowed and did exactly that. Eight projects with work in flight reaches it, and so does one project with thirty started issues, so it was always reachable. Both halves are cut to fit now, and the frame is clamped to the window as an enforced invariant rather than an intended one.

Then, while checking that: room for the stream can be zero, and `slice(-0)` is `slice(0)` — the whole array. A window with nothing to spare printed the entire history instead of none of it.

Also `terminal()` used `?? 24` for the row count, which does not catch a terminal reporting zero. Harmless before; with the frame trimming itself to fit, a zero would have rendered one line.

The per-project percentages were ragged until I looked at a real three-project frame; they are right-aligned so the counts beside them form a column. And fallow caught the source builder duplicated between the command and the registry collector — one function now, differing only in where the config came from.

The limit defaults to 8 with `--limit` to change it, and the header says how many were left out.
