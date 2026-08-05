---
id: 87
title: Search in the web UI
state: Done
parent: 86
assignee: claude
labels: [web, dx]
blockedBy: [86]
created: 2026-08-05T15:49:58Z
updated: 2026-08-05T17:08:53Z
---

## Description

The board shows every issue and offers no way to find one. At 82 issues that is already a scroll; the views were built when there were twenty.

Same search as the CLI, over the same core function, so the two cannot disagree about what matches.

## Plan

1. A search box in the shell, filtering the current view
2. Hits in bodies shown with their context, not just the title
3. Keyboard: focus the box, move through results, open one
4. Waits on the core search from #find

## Notes

### 2026-08-05T17:08:53Z — claude (agent)

A -opened overlay rather than a route: searching is something you do from wherever you are, and getting back to the board should not need the back button. Arrow keys move, enter opens, escape closes, and clicking the backdrop closes — the things a person tries without reading anything.

It goes through a new GET /api/search that calls the same core searchIssues the CLI does, so the surfaces cannot answer differently. The response type is derived with ReturnType like every other shape in that file, which is the habit that came out of /api/status once leaking whole issue objects because I hand-wrote its type.

Verified in a real browser as well as jsdom: / opens it, typing 'diff quality' finds the note in #0001 and shows whose note it was and when, and enter navigates to /issues/1 with the overlay gone. The jsdom tests cover the same paths and pass with no act() warnings.
