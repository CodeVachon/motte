---
id: 78
title: Bare `motte` printed `✗ null`
state: Done
parent: 3
labels: [cli, bug]
created: 2026-08-04T16:16:08Z
updated: 2026-08-04T16:16:09Z
---

## Description

Running `motte` with no arguments answered `✗ null` and exited 1, in a project and outside one.

The cause: `.demandCommand(1, "")`. The empty message was meant to suppress yargs' own wording, but yargs then calls the failure handler with a null message, which the handler stringified.

Reported by the user, who asked for the help list or the status instead.

## Plan

1. Bare motte in a project shows the status report and exits 0
2. Outside a project, the help, since there is no backlog to summarise
3. Keep a real demandCommand message so a flag-only invocation still says which command is missing
4. Harden the failure handler so a null message can never be printed again

## Notes

### 2026-08-04T16:16:08Z — claude (agent)

Fixed. Bare `motte` in a project prints the status report and exits 0; outside one it prints the help and
suggests `motte init`. Both on stdout, with stderr empty, because neither is a failure.

Rather than a wall of help above the report, the in-project case ends with two lines: `motte ready` and
`motte --help`. Reaching for the bare command is asking "where does this stand", and the answer to "what
now" is one of those two.

renderStatus is extracted from the status command rather than reimplemented, so the bare command and
`motte status` cannot drift apart.

The interesting part was a regression I introduced and then had to undo. My first fix registered a yargs `$0`
default command, which worked — and silently broke recommendCommands. With a `$0` command registered, an
unrecognised first word is an unknown *argument* rather than an unknown command, so `motte stauts` went from
"Did you mean status?" to "Unknown argument: stauts". I only caught it because I checked the near-miss case
against the pre-change binary rather than assuming the rest still behaved.

The bare case needs no yargs involvement at all: argv.length === 0 is checked before parsing. demandCommand
stays, now with a real message, so `motte --json` still says which command is missing instead of nothing.

Two things found along the way.

yargs' showHelp() defaults to console.error, so the no-project help was going to stderr on what is a success
path. It now passes "log".

And the in-process test harness captured console.log but not console.error — so anything a command wrote
through the latter was invisible to every test, including every usage block yargs emits. That is why the
stream mistake was not caught by the tests I had. Fixed; 686 tests still pass, so nothing was relying on the
gap.
