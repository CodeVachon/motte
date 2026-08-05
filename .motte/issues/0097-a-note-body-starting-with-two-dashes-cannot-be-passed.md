---
id: 97
title: A note body starting with two dashes cannot be passed
state: Todo
labels: [cli, bug]
created: 2026-08-05T17:39:57Z
updated: 2026-08-05T17:39:57Z
---

## Description

`motte note 89 "--fix repairs three findings…"` fails with "Not enough non-option arguments": yargs reads the body as a flag. The `--` separator does not help either, because yargs then puts the remainder in `argv["--"]` where the positional never sees it.

Found while writing a note about `doctor --fix` (#0089), which is exactly when it bites: notes in this project routinely quote flags, and the workaround — rephrase the sentence so it does not begin with a dash — means the tool is dictating prose.

The same applies to `motte add` for a title, and to `motte edit -d`.

## Plan

1. Read the body from stdin when it is omitted, so `motte note 89 < note.md` and a heredoc both work — which is the right answer for long notes anyway
2. Consider `parserConfiguration({ "populate--": false })` so the separator behaves as somebody would expect, and check what that does to every other command's positionals before relying on it
3. Tests: a body that starts with a dash, one that is only a dash, and stdin with no body argument
