---
id: 68
title: "doctor: warn when a settled issue has unsettled children"
state: Done
parent: 24
labels: [cli, core]
created: 2026-07-30T14:39:52Z
updated: 2026-08-04T21:26:34Z
---

## Description

Nothing currently flags an epic marked Done that still has open children. It happened during this session: #0064 was filed under #0005 while #0005 was already Done, so the tree reported the epic complete while carrying unstarted work, and `status` listed it under no active epic.

The tree and dependency checks both exist; this one does not, and it is the same class of quiet inconsistency they were added for.

## Plan

1. In dependencyProblems or a sibling, flag a settled issue with any unsettled descendant
2. Warning, not error — closing a parent before its children can be deliberate
3. Name the open children in the message so the fix is obvious
4. Test both directions: settled parent with open child warns, settled parent with settled children does not

## Notes

### 2026-08-04T21:26:34Z — claude (agent)

Implemented as subtreeProblems, covering both directions rather than only the one this issue described. The inverse — an unsettled parent whose whole subtree has settled — is what let #0004 sit open through four releases after the release pipeline was finished, and it misleads the progress report the same way: a closed epic carrying open work reports complete, an open one with nothing in it never reports finished. Both are warnings, since either can be deliberate. One pass over the tree hierarchyProblems already builds, and it names the open children, capped at six. Run against this repo it immediately found two real cases: #0024 carrying this issue, and #0067 carrying #0074.
