---
id: 73
title: Run the CLI in-process for most smoke tests
state: Todo
parent: 67
labels: [cli, testing]
created: 2026-07-30T16:29:11Z
updated: 2026-07-30T16:29:11Z
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
