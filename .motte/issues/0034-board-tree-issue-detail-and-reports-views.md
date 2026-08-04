---
id: 34
title: Board, Tree, Issue detail, and Reports views
state: Done
parent: 6
labels: [web]
created: 2026-07-29T11:56:00Z
updated: 2026-08-04T16:41:35Z
---

## Description

The four views. Board is a kanban by state with drag to change state. Tree shows the hierarchy with
drag to re-parent. Issue detail edits title, description, and plan inline and adds notes. Reports
renders the progress rollups.

## Plan

1. Board with drag-to-move
2. Tree with drag-to-re-parent, rejecting cycles
3. Issue detail with inline edit and note composer
4. Reports from `reports.ts`
5. Playwright pass over all four

## Notes

### 2026-08-04T16:41:34Z — claude (agent)

All four views built and driven in a real browser, which was step 5 of the plan.

Verified by hand with Playwright against a throwaway project, not by asserting that it compiles:

Board — three columns from the project's config, the blocked badge on the issue waiting on another, the
assignee chip. Dragged #0005 from Todo to In Progress and confirmed the file on disk changed and the event
log recorded the transition.

Tree — the hierarchy, and dragging #0005 onto #0001 re-parented it, again confirmed on disk. Then dragged a
parent onto its own child: the UI showed the server's own words, "that would create a cycle: #1 → #2 → #1",
and the file was left untouched. That is the point of not duplicating the rule in the client.

Detail — inline title edit, which renamed the file to the new title-derived slug, and a note appended through
the composer. Children and blocked-by lists render.

Reports — progress, counts, and the epic rollups.

Two real problems found in the process, both by comparing against the CLI rather than trusting the screen.

The epic rollups disagreed. The web said 25% (1/4) where `motte status --epics` said 20% (1/5). I had computed
them in the client from the issue list, counting direct children and excluding the epic itself, while core
scopes a rollup to the epic and every descendant. Two implementations of one question, which is exactly the
thing I have been removing everywhere else this week. The client's copy is gone; `/api/status` now returns
what core computes, and a test pins the definition including the grandchild case.

The event log disagreed with itself. A state change made in the browser was recorded as `web` while a note
typed in the same page was recorded under the git user, because notes resolve their author separately. The
log exists to say who did something and whether they were a person or an agent, and for the web UI the answer
is the person at the machine — the CLI does not label itself `cli` either. The server now resolves the author
the same way the CLI does, and a test asserts the note and the event agree.

Also fixed: the SSE test in server.test.ts now retries, for the same reason the watcher's integration test
does — it waits on the OS to notice a file write, and that is not something this project controls.

What is not done, and is now the biggest risk in the web UI: none of these views has an automated test. The
Playwright pass was manual and is not in CI. fallow reports eight CRAP findings across apps/web and every one
is that fact rather than a complexity problem. Filed as #0079 rather than suppressed.
