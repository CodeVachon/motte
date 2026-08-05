---
id: 93
title: Import from GitHub Issues
state: Done
assignee: claude
labels: [cli, dist]
created: 2026-08-05T15:49:59Z
updated: 2026-08-05T22:39:37Z
---

## Description

Nobody starts with an empty tracker. The people most likely to want this tool are the ones already carrying a GitHub Issues backlog they find heavier than the work deserves, and there is no path from there to here that is not copy and paste.

## Plan

1. `motte import --github owner/repo`, using the gh CLI if present and the API with a token otherwise
2. Map title, body, state, assignee and labels; put comments in notes with their authors and dates
3. Keep the original number in the body as a reference rather than trying to preserve it as the id
4. `--dry-run` prints what would be created; the import is otherwise unconditional and one-way
5. Say in the ReadMe that it is one-way and not a sync

## Notes

### 2026-08-05T22:39:36Z — claude (agent)

--github owner/repo works via the gh CLI or the REST API, and the mapping is pure so every decision is tested without a network. Verified against cli/cli: twelve real issues imported, doctor clean, real comments landing as attributed notes.

The plan's five steps are done, plus sub-issues become parent/child. GitHub gained that field and it maps exactly onto the tree, which is motte's distinguishing feature — an imported epic arriving without its children would be a poor import. gh reports it; the REST API does not, so that path says so rather than silently flattening.

The serious find came from asking what happens to a body that uses motte's own headings, after the twelve-issue import looked fine. `## ` at the start of a line is what divides an issue file into sections, and a GitHub body is full of them. Three outcomes, all bad: `## Notes` turned part of somebody's body into real motte notes attributed to people who never wrote one; `## Plan` moved text into the plan; and a `## Notes` inside a code fence produced a file motte itself refused to parse — an issue it had just created came back from motte list as broken.

Imported headings are demoted a level now. My first attempt indented them instead, which also stops the parser and changes nothing visible — but section content is trimmed on the way in and out, so a body whose first line is a heading lost the space on the next read and split anyway. The round-trip test caught that, which is exactly what it is for.

Two smaller things. gh installed but not logged in used to be a hard failure; with a token in the environment it falls back to the API, which is an ordinary CI setup. And MOTTE_GITHUB_API points at GitHub Enterprise — the same seam the tests use to run against a real local server, which is how the pull-request filtering and the pagination are actually exercised.

Also: adopt started as a near-copy of create differing only in where the dates and notes come from, and fallow caught it. One private primitive with two public doors now, so anything either validates is validated once.
