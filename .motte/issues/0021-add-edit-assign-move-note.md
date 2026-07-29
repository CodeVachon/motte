---
id: 21
title: add, edit, assign, move, note
state: Done
parent: 3
labels: [cli]
created: 2026-07-29T11:43:00Z
updated: 2026-07-29T16:04:10Z
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
