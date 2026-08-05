---
id: 89
title: doctor --fix for the findings that have one obvious repair
state: Todo
labels: [cli, dx]
created: 2026-08-05T15:49:58Z
updated: 2026-08-05T15:49:58Z
---

## Description

`doctor` reports and stops. Three of its findings already have an implemented fix elsewhere: a filename that disagrees with the frontmatter, a file that does not survive a round trip, and a duplicate id that `renumber` exists to repair.

Only the mechanical ones. A missing parent, a cycle, a stale started issue and a parent that disagrees with its subtree are all judgement calls, and guessing at those is how a tool loses trust.

## Plan

1. `--fix` repairs filename mismatches and round-trip normalisation, and calls the renumber plan
2. Everything else is reported unchanged, and `--fix` says plainly what it left alone and why
3. `--dry-run` first, matching prune's shape
4. Refuse on a dirty backlog, for the same reason prune does
