---
id: 93
title: Import from GitHub Issues
state: Todo
labels: [cli, dist]
created: 2026-08-05T15:49:59Z
updated: 2026-08-05T15:49:59Z
---

## Description

Nobody starts with an empty tracker. The people most likely to want this tool are the ones already carrying a GitHub Issues backlog they find heavier than the work deserves, and there is no path from there to here that is not copy and paste.

## Plan

1. `motte import --github owner/repo`, using the gh CLI if present and the API with a token otherwise
2. Map title, body, state, assignee and labels; put comments in notes with their authors and dates
3. Keep the original number in the body as a reference rather than trying to preserve it as the id
4. `--dry-run` prints what would be created; the import is otherwise unconditional and one-way
5. Say in the ReadMe that it is one-way and not a sync
