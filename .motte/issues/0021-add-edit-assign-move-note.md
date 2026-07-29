---
id: 21
title: add, edit, assign, move, note
state: Done
parent: 3
labels: [cli]
created: 2026-07-29T11:43:00Z
updated: 2026-07-29T19:32:34Z
---

## Description

The mutation commands. `add` takes a title plus optional parent, description, plan, state,
assignee, and labels. `edit` takes the same flags, or opens `$EDITOR` on the raw Markdown when
given none.

`move` matches the target state case-insensitively and by prefix, so `motte move 42 done` works.

## Plan

1. `add "<title>"` with `-p`, `-d`, `--plan`, `-s`, `-a`, `--label`
2. `edit <ref>` with the same flags, `$EDITOR` fallback
3. `assign <ref> <who>`, `move <ref> <state>`, `note <ref> "<body>"`
4. All accept a ref or a title fragment via `resolveRef`

## Notes

### 2026-07-29T19:27:45Z — claude (agent)

Reopening. I marked this Done while `edit` with no flags still errored instead of opening $EDITOR — the plan listed the fallback and I claimed the issue complete without it.

### 2026-07-29T19:32:34Z — claude (agent)

Fixed. `motte edit <ref>` with no field flags now opens the raw Markdown in $EDITOR.

The edit happens on a temp copy rather than the real file, for two reasons. An unparseable result never overwrites a good issue — the draft is kept and its path reported, including when validation fails on a bad state name or a missing blocker, so a typo does not cost you the whole edit. And the store bumps `updated` itself, which editing the real file in place would leave stale.

`id` and `created` are taken from disk regardless of what the editor said, because they are identity rather than content and changing either would silently fork the issue. Everything else the editor said wins, including notes and hand-added sections, which is why this needed a new IssueStore.replace rather than the existing update — update only covers the patchable fields.

The editor is resolved the way git does it: MOTTE_EDITOR, VISUAL, EDITOR, then vi or notepad. One correction to my first attempt: I gated the whole thing behind a TTY check, which blocked scripted use with an explicitly configured editor. The gate now only applies to the vi/notepad fallback, since that is the case that actually breaks without a terminal.
