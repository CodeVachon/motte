---
id: 62
title: Transition detection
state: Todo
parent: 60
labels: [cli, dx]
blockedBy: [61]
created: 2026-07-30T12:14:50Z
updated: 2026-07-30T12:14:50Z
---

## Description

Work out what actually changed between two snapshots: which issues appeared, which changed state, which got notes, which became ready.

A file event says something changed; it does not say what. The dashboard needs the difference, not the new state.

## Plan

1. diff(previous, next) returning typed transitions
2. Cover created, state changed, assigned, blocked/unblocked, note added, became ready
3. If the event log (#0056) exists by then, prefer tailing it over diffing — it already records exactly this
4. Tests over hand-built before/after pairs
