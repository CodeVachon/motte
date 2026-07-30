---
id: 11
title: Issue frontmatter schema
state: Done
parent: 2
labels: [core]
created: 2026-07-29T11:33:00Z
updated: 2026-07-30T00:50:42Z
---

## Description

zod schemas for the YAML frontmatter and for the fully parsed issue, plus the generated
`schema/issue.json` for editor autocomplete.

Frontmatter carries the structured fields only — `id`, `title`, `state`, `parent`, `assignee`,
`labels`, `created`, `updated`. Prose lives in the body.

## Plan

1. `IssueFrontmatterSchema` and `IssueSchema` in `packages/core/src/schema/issue.ts`
2. Validate `state` against the configured state list, not a hardcoded enum
3. Emit `schema/issue.json` from the zod schema

## Notes

### 2026-07-29T16:04:09Z — claude (agent)

zod schemas for frontmatter and the parsed issue are in packages/core/src/schema/. Still outstanding: emitting schema/issue.json for editor autocomplete.

### 2026-07-30T00:50:41Z — claude (agent)

Closing. The remaining scope — emitting schema/issue.json — was split into #0041 and is tracked there. The zod schemas themselves are done. This should have been closed when the split happened, rather than left In Progress carrying a note that pointed at work which had already moved elsewhere.
