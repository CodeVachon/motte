---
id: 86
title: motte find — search the issue bodies, not just the frontmatter
state: Done
assignee: claude
labels: [cli, core, agents]
created: 2026-08-05T15:49:57Z
updated: 2026-08-05T17:01:46Z
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

## Notes

### 2026-08-05T17:01:46Z — claude (agent)

searchIssues in core: plain case-insensitive substring over title, description, plan and note bodies, returning where each hit was — field and line number, or the note's date and author. A phrase rather than a regular expression, because 'where did we discuss the Host header' is what somebody types; anything cleverer is what grep is for, and the format exists to keep that possible.

Composes with the shared filters from #0074, which is that refactor paying for itself: a search narrows by state, label and assignee exactly the way a list does, with no second implementation of 'compare lowercased'.

Ranked title matches first, then more matches, then lowest id — the same explainable-ordering choice as next.

Verified against this repository: 'find rebinding' surfaces the DNS-rebinding reasoning buried in #0033's notes, which was previously reachable only by grepping the directory. That was the question that motivated the issue.
