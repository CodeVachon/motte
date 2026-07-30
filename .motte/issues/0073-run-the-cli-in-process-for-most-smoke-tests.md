---
id: 73
title: Run the CLI in-process for most smoke tests
state: Done
parent: 67
labels: [cli, testing]
created: 2026-07-30T16:29:11Z
updated: 2026-07-30T17:30:39Z
---

## Description

The CLI smoke tests spawn a real process per assertion, about 65 per run. That is what exposes them to the runner stall in #0072, and it is why the eleven command modules still read as 0% covered — v8 coverage does not follow subprocesses, which fallow has now flagged twice.

Calling run(argv) in-process would remove both problems at once: no spawns to stall, and coverage attributed properly. Most of what I originally argued needed a real process does not: argv parsing, the `version` positional collision, unknown-flag rejection and `--since 7` validation all go through yargs either way.

A small subprocess suite should stay for what genuinely needs process semantics — real exit codes, the EPIPE pipe case, and --version.

## Plan

1. Harness calling run(argv) with stdout/stderr captured and process.exit intercepted
2. Confirm vitest's pool allows process.chdir, or thread cwd through context() instead — commands call context() with no argument today
3. Force chalk to level 0 rather than relying on NO_COLOR, which chalk reads at import time
4. Verify the harness against the existing subprocess tests before deleting any of them — a harness that quietly diverges from real behaviour is the failure mode this project has hit four times
5. Keep subprocess coverage for exit codes, the EPIPE pipe, and --version

## Notes

### 2026-07-30T17:30:39Z — claude (agent)

Done. The five behavioural describes now run in-process; only `wiring` still spawns.

Both risks the plan flagged turned out to be non-issues, checked before building: vitest's default pool
allows process.chdir, and there is no module-level mutable state or memoized config in the CLI or core that
could leak between in-process runs.

The harness drives the exported main(argv) rather than run(argv). That distinction matters — run() skips
`report`, which is where every expected error becomes a clean line and an exit code, so testing run()
directly would have missed the behaviour most worth testing. index.ts now has main() and the
import.meta.main guard calls it, so tests and the binary take the same path.

One real divergence, and it is the thing to remember about this harness. Commands signal failure two ways:
`report` and yargs call process.exit, but init, doctor, prune and upgrade instead assign process.exitCode
and return normally. My first harness observed only process.exit and therefore reported 0 for every failing
command. Three tests caught it immediately — which is exactly why the plan said to port the existing tests
rather than write new ones alongside. Their assertions were the equivalence check.

Related: the harness restores process.exitCode, not just reads it. Leaving it set would make vitest's own
process exit non-zero with every test passing. Verified the suite exits 0.

Unplanned find while measuring: project() ran `git init` plus two `git config` calls per test on the
assumption prune and restore need a repo, but neither is exercised in this file — they appear only as names
in the help-registration list. That was 105 process spawns per run for nothing, and more spawn exposure than
the motte calls themselves. Removed.

Measured: statements 51.9% to 71.3%, this file 33s to 3.1s, the whole suite 37s to 15s. Every command module
is now non-zero where eleven were at 0%; init, context and completion are at 100%, doctor 64%, mutate 77%.
Three stay low — prune 7%, install 12%, mcp 18% — because this file genuinely does not exercise them, which
is worth stating plainly rather than leaving to look like an oversight.

Branches and functions fell in percentage, 90.9% to 86.6% and 83.2% to 79.5%, and that is not a regression:
the newly-loaded modules brought their own branches and functions into the denominator. Absolute covered
counts rose in every category.

Checked for state leaks rather than assuming: shuffled order twice and ran a describe in isolation, all
passing. fallow audit passes with zero findings.
