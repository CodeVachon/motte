---
id: 72
title: cli.test.ts hangs intermittently on CI
state: Todo
parent: 67
labels: [cli, testing, bug]
created: 2026-07-30T16:03:17Z
updated: 2026-07-30T16:03:17Z
---

## Description

The CLI smoke tests hang on the GitHub runner, roughly one run in three. The log shows all nineteen other test files passing within six seconds while cli.test.ts never reports at all, then the job sits until cancelled. A rerun of the identical commit passed, so it is a race or a resource limit, not a deterministic defect.

Not reproducible locally: the suite passes in ~36s, including with no TTY and stdin closed, which was my first guess.

Spawns are now bounded at 60s and CI reports verbosely, so the next occurrence should name the command that hangs instead of going dark on the whole file. That is the diagnostic, not the fix.

## Plan

1. Wait for the next hang and read which test the verbose reporter last completed
2. Suspect order: the piped 'sh -c bun ... | head -2' EPIPE case, then contention from ~65 cold bun spawns on a 2-core runner
3. If it is contention rather than a deadlock, consider running cli.test.ts in a single worker, or replacing the per-assertion spawn with one spawn per scenario
4. Keep the 60s spawn bound regardless — it is what turns a silent hang into a named failure

## Notes

### 2026-07-30T16:03:17Z — claude (agent)

Filed after the fact: 98d7ab2 references this issue in its commit message, written before the issue existed.
