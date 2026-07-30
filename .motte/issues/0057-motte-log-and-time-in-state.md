---
id: 57
title: motte log and time-in-state reporting
state: Todo
parent: 55
labels: [cli, reports]
blockedBy: [56]
created: 2026-07-29T20:17:00Z
updated: 2026-07-29T20:17:00Z
---

## Description

The payoff for keeping the log. A timeline for one issue or the whole project, and the aggregates
that only a transition history can produce.

Time-in-state is the one that motivated this: it makes a stale-In-Progress warning buildable, which
is exactly what could not be written when #0011 and #0015 sat In Progress after their work had moved
into #0041 and #0042.

## Plan

1. `motte log [ref]` — a merged timeline of events and the notes already in the issue files
2. `--since 7d` / `--since 2026-07-01` on `log` and `status`
3. Time-in-state per issue, and a median across the project
4. `doctor` warning for an issue that has been in a started state longer than a configurable window
5. `--json` on all of it

## Notes

### 2026-07-29T20:17:00Z — claude (agent)

The timeline merges rather than duplicates: notes come from the issue files, transitions from the
event shards, sorted together by timestamp. Storing notes as events too would mean two records of the
same thing that could disagree.

A pruned issue still appears in the timeline, from its tombstone — that is much of the point of
recording one.
