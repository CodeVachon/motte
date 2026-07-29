---
id: 24
title: motte doctor
state: Done
parent: 3
labels: [cli, testing]
created: 2026-07-29T11:46:00Z
updated: 2026-07-29T16:04:10Z
---

## Description

Validate the whole backlog and report every problem at once: schema violations, duplicate ids,
cycles, parents pointing at missing issues, unparseable files, and states not present in the
config.

Exits non-zero when anything is wrong, so it can run in CI against this repo's own backlog.

## Plan

1. Collect all problems rather than failing on the first
2. Group by severity, with the file path on every line
3. `--json` and a non-zero exit on error
4. Wire into `bun run doctor` and CI
