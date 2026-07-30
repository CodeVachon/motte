---
id: 40
title: Automated CLI smoke test
state: Todo
parent: 3
labels: [cli, testing]
created: 2026-07-29T16:04:10Z
updated: 2026-07-30T14:27:04Z
---

## Description

The CLI was verified by a hand-run scripted sequence against a temp project. That needs to become a committed test so it runs in CI.

## Plan

1. Spawn the CLI against a temp dir via Bun.$
2. init → add → add --parent → move → note → assign
3. Assert on --json output rather than human text
4. Cover the failure paths: ambiguous ref, unknown state, cycle

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
