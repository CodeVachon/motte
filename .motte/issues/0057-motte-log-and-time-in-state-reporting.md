---
id: 57
title: motte log and time-in-state reporting
state: Done
parent: 55
labels: [cli, reports]
blockedBy: [56]
created: 2026-07-29T20:17:00Z
updated: 2026-07-30T12:47:07Z
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

### 2026-07-30T12:47:07Z — claude (agent)

Done. motte log with --since, --limit and --no-notes, per-issue time-in-state, and a doctor warning for
work that has been started too long.

The timeline merges transitions from the log with notes from the issue files at read time, rather than
storing notes twice. Two records of the same thing can disagree; one cannot.

The doctor warning is the thing this epic existed for. #0011 and #0015 sat In Progress after their
remaining scope had moved into other issues and nothing could notice, because the files carry no
state-transition history. It now warns after 7 days by default, --stale-after 0 disables it, and it stays
quiet when the log is empty rather than pretending everything is fresh.

Deviation from the plan: the window is a CLI flag rather than a config setting. A flag is configurable
without adding config surface for something that will rarely be tuned, and it still fires by default in
CI.

Two bugs caught by writing the tests rather than by reading the code.

--since 7 was silently accepted. Date.parse("7") succeeds and yields some arbitrary date, so a bare
number would have meant something nobody intended. Now rejected with a message suggesting 7d.

The empty-result message was wrong when --since filtered everything out: it said "no history recorded
yet" when there was plenty of history, just none in range. The two cases are now distinguished.
