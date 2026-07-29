---
id: 40
title: Automated CLI smoke test
state: Todo
parent: 3
labels: [cli, testing]
created: 2026-07-29T16:04:10Z
updated: 2026-07-29T16:04:10Z
---

## Description

The CLI was verified by a hand-run scripted sequence against a temp project. That needs to become a committed test so it runs in CI.

## Plan

1. Spawn the CLI against a temp dir via Bun.$
2. init → add → add --parent → move → note → assign
3. Assert on --json output rather than human text
4. Cover the failure paths: ambiguous ref, unknown state, cycle
