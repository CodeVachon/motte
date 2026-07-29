---
id: 43
title: Note bodies swallow level-2 headings
state: Done
parent: 2
labels: [core, bug]
created: 2026-07-29T16:05:55Z
updated: 2026-07-29T16:07:21Z
---

## Description

A note whose body contains a line starting with `## ` has that line and everything after it torn out of the note and reclassified as an unknown section.

The file still round-trips byte for byte, so nothing is lost on disk, but the note is silently truncated and its tail is misattributed. Agents write Markdown into notes routinely, so this will happen.

## Plan

1. Reproduce in a test: a note body containing a `## ` line
2. Fix by making Notes terminal — once inside the Notes section, split only on `### ` and never on `## `
3. Have doctor flag any issue where a known section appears after Notes, since that is now unreachable
4. Confirm the seed files still round-trip

## Notes

### 2026-07-29T16:05:56Z — claude (agent)

Reproduced. parseIssueFile returns a note body truncated at the heading line, and the remainder shows up in unknownSections as "Design notes". formatIssueFile still reproduces the input byte for byte, which is why the existing round-trip suite does not catch it — the bug is semantic, not lossy.

### 2026-07-29T16:07:21Z — claude (agent)

Fixed. Once a note heading has been seen, the remainder of the file belongs to that note, so `## ` no longer starts a section there. Deliberately scoped to *after* the first note heading rather than to the whole Notes section, so a file with an empty `## Notes` followed by another section still parses — the blunt version regressed that case. Three regression tests added, including one for the second note in a file.
