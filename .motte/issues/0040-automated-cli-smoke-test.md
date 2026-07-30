---
id: 40
title: Automated CLI smoke test
state: Done
parent: 3
labels: [cli, testing]
created: 2026-07-29T16:04:10Z
updated: 2026-07-30T14:52:51Z
---

## Description

The CLI was verified by a hand-run scripted sequence against a temp project. That needs to become a committed test so it runs in CI.

## Plan

1. Spawn the real CLI against a temp project with node:child_process — NOT Bun.$, which is undefined
   under vitest (see AGENTS.md)
2. init → add → add --parent → move → note → assign → block → ready
3. Assert on --json output rather than human text, so the tests do not break on cosmetic changes
4. Cover the failure paths: unknown ref, ambiguous ref, unknown state, parent cycle, no project
5. Cover the wiring specifically — flag names, exit codes, --version — since that is what has actually
   broken in practice

## Notes

### 2026-07-30T14:27:04Z — claude (agent)

Quantified by fallow, which independently found this gap and made it the largest single item in the
project's health picture.

Measured coverage after installing @vitest/coverage-v8: 51% of statements overall, and every one of the
twelve files under packages/cli/src/commands/ at exactly 0%. index.ts is 0% too.

All fourteen remaining critical CRAP findings are CLI command handlers. The worst are doctor 992, log 702,
show 506, prune 420, install 342. CRAP is complexity squared against untested-ness, so these are high
because they are both branchy and completely unexercised.

The most telling number: feeding real coverage to fallow cut critical findings from 28 to 14. Everything
that dropped off — buildTree, transitionsBetween, planPrune, expectedAt, IssueStore.update and all — was
core code that is genuinely well tested and had only looked risky under fallow's zero-coverage estimate.
The core is fine. The CLI layer is the whole problem, and it is the one surface a user actually touches.

Also worth recording: the test:coverage script has been in package.json since the scaffold but was never
runnable — @vitest/coverage-v8 was not installed. Fixed. Note that the provider must match vitest's major
version; coverage-v8@4 fails against vitest@3 with a confusing BaseCoverageProvider export error.

### 2026-07-30T14:39:24Z — claude (agent)

Correction to my note above: "every one of the twelve files under packages/cli/src/commands/ at exactly
0%" is wrong. Eleven are at 0%. commands/log.ts is at 20.8%, because log.test.ts covers parseSince and
formatDuration, which live in that file. The "completely unexercised" characterisation of log 702 inherits
the same error.

My own coverage output showed this — log.ts was absent from the zero-coverage list I printed — and I did
not read it carefully enough before writing the note down.

Two better framings of the same data, now that coverage is scoped to packages/*/src:

Statements 51.6%, but branches 91% and functions 82.5%. The code that actually runs under test is well
covered; the statement figure is dominated by whole files no test ever imports. The gap is not
half-tested code, it is eleven entirely unloaded command modules.

Whoever picks this up should expect a partial head start in log.ts, not a clean slate of twelve.

### 2026-07-30T14:45:03Z — claude (agent)

Two decisions before writing this.

The plan said to spawn via Bun.$. That cannot work: vitest runs on Node, so Bun globals are undefined in
tests — the constraint already recorded in AGENTS.md after download.ts hit it. Using node:child_process
spawnSync instead.

Subprocess rather than in-process, deliberately, and it is a real trade-off. Calling run(argv) directly
would be faster and would attribute coverage, but it bypasses the part that actually breaks. Every CLI
regression this project has hit was wiring or parsing: a positional named `version` colliding with yargs'
--version flag, `--since 7` silently accepted because Date.parse takes it, an unhandled EPIPE on `| head`.
In-process tests would have caught none of those cleanly.

The cost is that the coverage number will barely move, because v8 coverage does not follow subprocesses.
Anyone re-running fallow after this should not read that as the work not having been done — the eleven
command modules are now exercised end to end, just not through a channel the coverage provider can see.

### 2026-07-30T14:52:51Z — claude (agent)

Done. 32 end-to-end tests in packages/cli/src/cli.test.ts, spawning the real entry point against a temp
git project and asserting on --json rather than human text.

The tests found a real product bug, which is the main argument for having written them.

issueJson in context.ts did not include blockedBy. Dependencies landed after that function was written and
nothing updated it, so every CLI --json response omitted blockers entirely — `motte block 2 1 --json`
reported success without showing what it had recorded, and `list --json` gave an agent no way to see
dependencies at all. The MCP server has its own shape which does include blockedBy, so the two surfaces
had been quietly disagreeing since #0052. Fixed, and now asserted.

Coverage moved from 51.58% to 51.57%, which is the expected outcome and not a failure: v8 coverage does not
follow subprocesses. The eleven command modules are now exercised end to end through the channel that
actually breaks. Recorded in AGENTS.md so a future fallow run is not misread as this work being undone.

Cost: the suite went from about 4 seconds to about 37, since each assertion is a process spawn. Raised
testTimeout to 30s in vitest.config.mjs. One of my own tests had to shrink — it spawned forty `motte add`
calls to build a long list for the EPIPE check, where five is enough for `head -2` to close the pipe.

The wiring block is deliberately regression-shaped: every test in it corresponds to a bug this project
actually hit — the `version` positional colliding with yargs' --version flag, `--since 7` silently
accepted, the unhandled EPIPE, and a help-registration check that would have caught a command wired into
the file but never registered.
