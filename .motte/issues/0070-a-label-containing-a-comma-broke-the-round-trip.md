---
id: 70
title: A label containing a comma broke the round trip
state: Done
labels: [core, cli, bug]
created: 2026-07-30T15:19:20Z
updated: 2026-07-30T15:19:20Z
---

## Description

`motte add -l cli,testing,mcp` created one label named `cli,testing,mcp`. The frontmatter writer emitted it bare into the inline list, and the parser then read it back as three labels — so the file no longer survived parse/format, which is the format's one hard guarantee.

Caught by the round-trip test over this project's own backlog, in CI, after a push. Nothing local noticed: the file parsed, and `motte doctor` was happy.

## Plan

1. Quote inline-list items containing flow indicators (serialize.ts)
2. Split comma-separated --label values so `-l a,b` means two labels
3. Give doctor a round-trip check so this class is caught locally, not in CI

## Notes

### 2026-07-30T15:19:20Z — claude (agent)

Three fixes, because there were three separate failures behind one symptom.

The format bug. isPlainScalarSafe rejected a leading comma but not an interior one. That is correct for a
block scalar — `title: First, second` needs no quotes — but wrong inside `labels: [...]`, where a comma is
structural. Added a `flow` mode used only by inline-list items, so the two contexts get different rules
rather than one blunt stricter rule that would over-quote titles.

The input bug. `-l a,b` is what anyone would type, and taking it literally is how the bad value got created
in the first place. normaliseLabels now splits on commas, trims, drops blanks and collapses duplicates,
for both add and edit.

The detection gap, which is the one that actually matters. doctor validated plenty but never checked the
guarantee the format rests on, so a corrupt-but-parseable file passed every local check and only CI noticed.
IssueStore.notRoundTrippable() now reports issues whose file would change if written back, and doctor
surfaces it as an error. It lives in the store rather than in doctor because that is where brokenFiles()
lives — it is a storage-integrity question, and putting it there made it unit-testable in-process, which
the CLI-side version was not.

Process failure worth recording separately, because the code bug was the smaller problem. I ran the full
suite, then did one more mutation (motte add, which created the bad file), then committed without re-running
anything. Same shape as the 11c6353 failure: verify, then mutate, then push. The rule that would have caught
both is to run the checks after the last write that touches the repo, and to gate the commit on the exit
code rather than eyeballing output.

fallow also caught me making doctor's handler worse — I had added ~30 lines to what was already the most
complex function in the project, 992 CRAP to 1260. Moving the check into the store put it back to 992, and
cleared a duplication finding in mutate.ts on the way by extracting reportMutation from the identical add
and edit tails.
