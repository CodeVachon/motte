---
id: 62
title: Transition detection
state: Done
parent: 60
labels: [cli, dx]
blockedBy: [61]
created: 2026-07-30T12:14:50Z
updated: 2026-08-05T14:11:24Z
---

## Description

Work out what actually changed between two snapshots: which issues appeared, which changed state, which got notes, which became ready.

A file event says something changed; it does not say what. The dashboard needs the difference, not the new state.

## Plan

1. diff(previous, next) returning typed transitions
2. Cover created, state changed, assigned, blocked/unblocked, note added, became ready
3. If the event log (#0056) exists by then, prefer tailing it over diffing — it already records exactly this
4. Tests over hand-built before/after pairs

## Notes

### 2026-08-05T14:11:24Z — claude (agent)

snapshotChanges(config, previous, next) in core. Plan step 3 said to tail the event log instead of comparing snapshots; it does both, and the reasons are worth recording. The log is not complete — notes are deliberately absent from it, and readiness is derived rather than stored, so nothing records that closing one issue unblocked another. It can also be switched off. And a file edited by hand produces no event at all, which is exactly the kind of change a watcher should show. So detection always compares snapshots, which cannot miss anything, and the log supplies the one thing a comparison cannot recover: who did it.

Reuses transitionsBetween — the same function the store uses to write events — so a change carries the same shape whether it came from the log or from a comparison, and there is one vocabulary to render rather than two.

A mutation check earned its keep: matching an event to a derived transition on the issue id alone survived the whole suite. Two transitions on one issue in a burst would then credit an unlogged assignment to whoever moved the state — usually the same person, which is why it would have gone unnoticed. Test added, mutation now caught.
