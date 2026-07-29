---
id: 17
title: Tree building, cycles, and orphans
state: Done
parent: 2
labels: [core]
created: 2026-07-29T11:39:00Z
updated: 2026-07-29T16:04:09Z
---

## Description

Build the parent/child forest from flat frontmatter, and detect the three ways it can be broken: a
cycle, a `parent` pointing at an id that does not exist, and an issue whose file is unreadable.

## Plan

1. Index by id, group by parent, sort children by id
2. Cycle detection with the offending path in the error
3. Missing-parent and unparseable-file detection, surfaced through `motte doctor`
4. Reject `setParent` that would create a cycle
