---
id: 72
title: cli.test.ts hangs intermittently on CI
state: Done
parent: 67
labels: [cli, testing, bug]
created: 2026-07-30T16:03:17Z
updated: 2026-07-30T16:29:11Z
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

### 2026-07-30T16:29:11Z — claude (agent)

Diagnosed and made reliable, though the stall itself is still unexplained.

What the instrumentation bought: with spawns bounded, two of three CI reruns of the same commit failed
instead of hanging, and named the culprit. `motte init --name Test` stalled in one, `motte add First` in
another — both at exactly the 60s bound, while neighbouring spawns in the same run finished in 158ms to
1000ms. Different trivial commands, so it is not a deadlock in any code path. CI baseline for this file is
27s, so an 18-minute non-completion was 40x, not slowness.

Ruled out along the way: `upgrade --check` reaching the network (requireInstall throws first), an
interactive prompt (there is no inquirer and nothing reads stdin outside the editor TTY guard),
`mcp --print-config` starting the server (it returns first), EPIPE handling (exits 0 on both the thrown
write and the stream error event), and CPU contention — under 2x oversubscription locally the suite slowed
1.8x and never hung.

Fix: bound each spawn at 20s, a twentyfold margin over the observed worst case, and retry each test twice.
The retry is on the test, not the command, and that distinction is the point — a stalled `motte add` may
have written its file before stalling, so retrying the command could double-apply, while retrying the test
cannot because beforeEach builds a fresh temp project per attempt. Verified that retries actually fire in
vitest 3.2.7 with a throwaway probe that fails only on its first attempt, rather than trusting a green run.

Two retries rather than one from the observed rate: roughly 3% of spawns stalled, which with a single retry
would still leave about one run in eight red across 35 tests.

What is not fixed: why an ordinary bun spawn occasionally never returns on a GitHub runner. #0073 proposes
removing the exposure entirely by running the CLI in-process, which would also fix the coverage attribution
fallow keeps flagging. Until then the retry keeps CI honest rather than silent — a stall still prints.
