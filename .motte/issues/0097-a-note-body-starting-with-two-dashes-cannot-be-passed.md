---
id: 97
title: A note body starting with two dashes cannot be passed
state: Done
assignee: claude
labels: [cli, bug]
created: 2026-08-05T17:39:57Z
updated: 2026-08-05T18:47:09Z
---

## Description

`motte note 89 "--fix repairs three findings…"` fails with "Not enough non-option arguments": yargs reads the body as a flag. The `--` separator does not help either, because yargs then puts the remainder in `argv["--"]` where the positional never sees it.

Found while writing a note about `doctor --fix` (#0089), which is exactly when it bites: notes in this project routinely quote flags, and the workaround — rephrase the sentence so it does not begin with a dash — means the tool is dictating prose.

The same applies to `motte add` for a title, and to `motte edit -d`.

## Plan

1. Read the body from stdin when it is omitted, so `motte note 89 < note.md` and a heredoc both work — which is the right answer for long notes anyway
2. Consider `parserConfiguration({ "populate--": false })` so the separator behaves as somebody would expect, and check what that does to every other command's positionals before relying on it
3. Tests: a body that starts with a dash, one that is only a dash, and stdin with no body argument

## Notes

### 2026-08-05T18:47:08Z — claude (agent)

--fix now passes, which is the check: this note was written with the escape it adds, and step 2 of the plan turned out to be wrong.

`parserConfiguration({ "populate--": false })` does not help, and it is already the default. Probing yargs directly showed why: with `--`, the text does land in `_`, but the positional's demand check fails *first* and the positional is never filled. So the fix is to declare the free-text positional optional and pick the value back out of `_`. That is what makes `motte note 42 -- "--dry-run …"` work.

The bare form still fails. Persuading the parser to accept a dashed positional without `--` would put every real flag at risk, so instead the refusal now teaches the escape — the original failure said "Unknown argument: fix repairs" and nothing else, which is why this took two encounters to diagnose.

Two things reading the output revealed. A bare `-` looked like it worked before and did not: yargs turns it into an empty string, so `motte note 1 -` recorded an empty note and reported success. It is refused now, as is an empty title. And stdin has to be read synchronously from fd 0, verified against a producer that waits two seconds and a body larger than one pipe buffer; the EAGAIN path exists because Node puts fd 0 in non-blocking mode, which is how the in-process tests reach it.

Also fixed a gap left by #0090: `merge` was missing from the completion table, so neither of its refs completed.
