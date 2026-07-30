---
id: 65
title: Reduce complexity in the doctor handler
state: Done
parent: 67
labels: [cli, health]
created: 2026-07-30T14:27:04Z
updated: 2026-07-30T17:51:16Z
---

## Description

The doctor handler is cyclomatic 31, cognitive 44, 155 lines — the worst single function in the project on every complexity measure, and the highest CRAP at 992.

It accumulates seven independent check families inline. Each is simple; the total is not.

## Plan

1. One function per check family, each returning Problem[]
2. The handler becomes: run the checks, group by severity, render
3. That also makes the checks unit-testable without spawning the CLI, which is what the 992 is really about

## Notes

### 2026-07-30T17:51:16Z — claude (agent)

Correcting the premise before recording the result. This issue said CRAP 992 and "the highest in the
project". That was true when filed but stale by the time I picked it up: #0073 moved the CLI tests
in-process, which took doctor.ts from 0% to 59.5% coverage and CRAP from 992 to 99.8. The highest CRAP in
the project is now prune's handler at 420.

The refactor still stood, on complexity rather than CRAP. At cyclomatic 32, cognitive 45 and 167 lines it
was the only function in the project exceeding all three thresholds at once.

Seven check families extracted, one function each, taking plain data rather than the store so they can be
exercised with no project on disk. The handler is now gather, concat, split by severity, render. Rendering
came out too — it had its own branching and contributed to the cognitive score.

Result: doctor.ts no longer appears in fallow's complexity findings at all, and is at 100% statements,
97.8% branches, 100% functions. 21 new unit tests.

The tests are the part worth having. Cases that were prohibitively awkward before are now trivial: a
blocker that does not exist, an event log with no events, --stale-after 0, an event log line numbered 0, an
issue with no filePath yet. Each needed a purpose-built broken backlog in a temp directory when the only way
in was through the CLI.

Two things caught me, both my own fixtures rather than the code. Events use short keys — at/id/by/as, not
issue/actor — and EventsConfig has no `dir` field. The first typechecked only because I had written `as
Event`, and the cast defeated exactly the check that would have caught it. Removing the cast let TypeScript
validate the fixture, which is how it should have been written in the first place.
