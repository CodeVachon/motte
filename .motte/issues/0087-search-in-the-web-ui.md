---
id: 87
title: Search in the web UI
state: Todo
parent: 86
labels: [web, dx]
blockedBy: [86]
created: 2026-08-05T15:49:58Z
updated: 2026-08-05T15:50:39Z
---

## Description

The board shows every issue and offers no way to find one. At 82 issues that is already a scroll; the views were built when there were twenty.

Same search as the CLI, over the same core function, so the two cannot disagree about what matches.

## Plan

1. A search box in the shell, filtering the current view
2. Hits in bodies shown with their context, not just the title
3. Keyboard: focus the box, move through results, open one
4. Waits on the core search from #find
