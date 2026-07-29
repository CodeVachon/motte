---
id: 12
title: parseIssueFile and formatIssueFile round-trip
state: Done
parent: 2
labels: [core, testing]
created: 2026-07-29T11:34:00Z
updated: 2026-07-29T16:04:09Z
---

## Description

The heart of the format. `parseIssueFile` reads a Markdown file into an `Issue`;
`formatIssueFile` writes it back. `format(parse(x))` must equal `x` byte for byte.

Known sections are fixed and ordered — Description, Plan, Notes. Missing sections are tolerated.
**Unknown sections must be preserved verbatim** so prose a human adds by hand is never destroyed by
a subsequent write.

## Plan

1. Frontmatter split and YAML parse
2. Section tokenizer over `## ` headings, retaining unknown sections with their original position
3. Note parser for `### <iso> — <name> (<user|agent>)` headings
4. Round-trip test over every file in this repo's own `.motte/issues/`

## Acceptance

- Every hand-authored seed file parses without error
- `format(parse(x)) === x` for all of them, including this file's extra sections
- A file with no Plan and no Notes round-trips
- A file with an unrecognised `## Risks` section keeps it, in place

## Risks

Notes are append-only in one file, so two branches adding notes to the same issue produce an
append/append git conflict. Acceptable at this scale; if it becomes a nuisance, promote notes to
`.motte/issues/0042/notes/<ts>-<author>.md`.

## Notes

### 2026-07-29T11:34:00Z — claude (agent)

This file deliberately carries `## Acceptance` and `## Risks` sections. They are not in the known
set, so this issue is its own fixture for unknown-section preservation.

### 2026-07-29T16:04:09Z — claude (agent)

All 39 hand-authored seed files round-trip byte for byte. Unknown-section preservation verified against #0012 itself, which carries Acceptance and Risks sections for exactly that purpose.
