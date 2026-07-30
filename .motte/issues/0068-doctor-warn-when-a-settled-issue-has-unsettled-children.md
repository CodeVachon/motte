---
id: 68
title: "doctor: warn when a settled issue has unsettled children"
state: Todo
parent: 24
labels: [cli, core]
created: 2026-07-30T14:39:52Z
updated: 2026-07-30T14:39:52Z
---

## Description

Nothing currently flags an epic marked Done that still has open children. It happened during this session: #0064 was filed under #0005 while #0005 was already Done, so the tree reported the epic complete while carrying unstarted work, and `status` listed it under no active epic.

The tree and dependency checks both exist; this one does not, and it is the same class of quiet inconsistency they were added for.

## Plan

1. In dependencyProblems or a sibling, flag a settled issue with any unsettled descendant
2. Warning, not error — closing a parent before its children can be deliberate
3. Name the open children in the message so the fix is obvious
4. Test both directions: settled parent with open child warns, settled parent with settled children does not
