---
id: 55
title: Event log
state: Done
labels: [core, reports]
created: 2026-07-29T20:15:00Z
updated: 2026-07-30T13:48:56Z
---

## Description

A committed, append-only record of issue transitions, so questions about *history* become answerable:
how long did this sit in progress, what moved last week, when did that epic actually finish.

None of this is recoverable today. The issue files carry `created` and `updated` only, and `updated`
moves on any edit, so time-in-state cannot be derived. This is the gap that made a stale-In-Progress
check unbuildable when #0011 and #0015 sat In Progress after their work had moved elsewhere.

Committed rather than local, for the same reason the issues are: a per-machine log means two people
get different answers to "what shipped last week".

## Plan

1. Event schema and the append path (#0056)
2. `motte log` and time-in-state reporting (#0057)
3. `motte prune` — unified across issues and events, manually triggered (#0058)
4. `motte restore` from a tombstone (#0059)

## Notes

### 2026-07-29T20:15:00Z — Christopher Vachon (user)

Worth adding so long as it stays manageable. Since it is committed, it also raises how we remove
older completed issues: a prune could drop completed issues past a certain age along with their
events, and add an event recording that the item was pruned and the last commit it appeared in, so it
could be retrieved. This should be a triggered operation, not an automated one.

### 2026-07-29T20:15:00Z — claude (agent)

Volume, estimated from this project — roughly one day of unusually heavy agent activity produced 54
issues, about 35 notes, about 40 state moves and 5 blocker links, so on the order of 135 events. At
about 110 bytes per compact JSON event: 1,000 events is 110KB, 10,000 is 1.1MB, and 100,000 is about
11MB and around two years at that intensity. Not a near-term concern, but growth should still be
bounded by design rather than by that assumption. These are estimates, not measurements — worth
confirming with a real count once the log exists.

Two decisions that cut volume without costing anything.

Do not log what the issue file already records. Notes already carry their own timestamp and author,
so logging them again is duplication, and they were roughly a quarter of the estimate above. The log
records transitions only: created, state, assigned, parent, blocked, unblocked, title. A unified
timeline for `motte log` merges file notes with events at read time rather than storing both.

Do not log content changes. `git log -p` on the issue file already holds that history. The event log
exists for what git cannot answer cheaply — semantic transitions with timing, queryable without
shelling out, and present before anything is committed.

### 2026-07-30T12:47:07Z — claude (agent)

Recording (#0056) and reporting (#0057) are done. Remaining children are #0058 prune and #0059 restore, which are maintenance rather than capability — the log is fully usable without them, and the web UI can consume it now.

### 2026-07-30T13:48:56Z — claude (agent)

Epic complete: recording (#0056), reporting (#0057), pruning (#0058) and restoring (#0059).
