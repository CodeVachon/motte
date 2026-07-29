---
id: 53
title: Dependency cycle and integrity checks
state: Todo
parent: 50
labels: [core]
created: 2026-07-29T18:55:17Z
updated: 2026-07-29T18:55:17Z
---

## Description

A dependency cycle is a deadlock — every issue in it waits on another, so nothing is ever ready. This needs its own detection, because tree.ts only walks parent links.

## Plan

1. Reject a block that would close a cycle, mirroring how setParent rejects parent cycles
2. doctor: dependency cycles, and blockers that do not exist
3. doctor warning for an issue in a started state whose blockers are not complete — you are working on something that is not ready
4. Decide whether an issue may be blocked by its own ancestor
