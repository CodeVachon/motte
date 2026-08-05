---
id: 86
title: motte find — search the issue bodies, not just the frontmatter
state: Todo
labels: [cli, core, agents]
created: 2026-08-05T15:49:57Z
updated: 2026-08-05T15:49:57Z
---

## Description

Descriptions, plans and notes are invisible to every query motte offers. `list` filters frontmatter; a ref matches a title fragment. Everything else — the reasoning, the dead ends, the decisions — can only be reached with `grep -r .motte/issues`.

That is the half of the record with the most in it. 'Where did we discuss the Host header?' is a real question I have had to answer with grep in this repository, at 82 issues. At 300 it stops being annoying and starts making the notes worthless.

## Plan

1. `searchIssues(issues, query, options)` in core: case-insensitive, over title, description, plan and note bodies
2. Report where the hit was and the line around it, so the result is readable without opening the file
3. `motte find <text>` with `--json`, and the existing filters so it composes with state and label
4. `--all` across projects, since the registry makes that possible now
5. A `search_issues` MCP tool — an agent looking for prior reasoning is the main caller
