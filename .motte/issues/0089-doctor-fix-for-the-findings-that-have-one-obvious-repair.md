---
id: 89
title: doctor --fix for the findings that have one obvious repair
state: Done
assignee: claude
labels: [cli, dx]
created: 2026-08-05T15:49:58Z
updated: 2026-08-05T17:39:37Z
---

## Description

`doctor` reports and stops. Three of its findings already have an implemented fix elsewhere: a filename that disagrees with the frontmatter, a file that does not survive a round trip, and a duplicate id that `renumber` exists to repair.

Only the mechanical ones. A missing parent, a cycle, a stale started issue and a parent that disagrees with its subtree are all judgement calls, and guessing at those is how a tool loses trust.

## Plan

1. `--fix` repairs filename mismatches and round-trip normalisation, and calls the renumber plan
2. Everything else is reported unchanged, and `--fix` says plainly what it left alone and why
3. `--dry-run` first, matching prune's shape
4. Refuse on a dirty backlog, for the same reason prune does

## Notes

### 2026-08-05T17:39:37Z — claude (agent)

Repairs exactly three findings: a duplicate id via the renumber plan from #0042, a filename that disagrees with its frontmatter, and a file that would be rewritten if written back. The last two turned out to be one operation — format the issue and put it at the name its id and title imply — so they are one store method, normalise(), rather than two.

normalise deliberately does not touch updated. Neither repair changes what the issue says, and bumping the timestamp would make tidying look like an edit in every report that reads it, the stale-work check included.

Plan step 4 said to refuse on a dirty backlog, the way prune does. I did not, and the two commands are not alike: prune deletes files and records a commit pointer that a dirty tree would invalidate, while the common case for wanting this is a working tree dirty precisely because of the hand-edit that caused the problem — renaming an issue's title in the file is what leaves the filename stale. Refusing there would make the command useless exactly when it is wanted. The dry run is the safety instead, and every change is reported.

The first dry run was misleading and only reading its output showed it: it reported every candidate as 'renamed to what its id and title imply', including files the renumber pass was about to move anyway. I had refused to read files in a dry run, conflating reading with writing. The decision now lives once in normalise({ dryRun }), and a test asserts the dry run and the real run produce identical output — the property that was actually broken.

Writing this note also exposed a bug, now #0097: a note body beginning with two dashes cannot be passed at all, because yargs reads it as a flag and the -- separator puts it somewhere the positional never sees.
