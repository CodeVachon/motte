---
id: 85
title: motte claim — refuse the second agent rather than letting both start
state: Done
parent: 83
labels: [cli, core, agents]
created: 2026-08-05T15:49:57Z
updated: 2026-08-05T16:20:32Z
---

## Description

Two agents, one backlog. Both call `ready_issues`, both get #0042, both move it to In Progress and start writing. The second write wins, the first agent's work is orphaned, and the record shows one assignee — so nothing in the tool ever said this happened.

`motte claim <ref>` should be compare-and-set: set assignee and a started state together, and refuse if somebody else already holds it. Within one working tree that is decidable, which is the case that matters — two agents in one repo. Across branches git remains the arbiter, the same bargain the rest of the format makes, and `doctor` already reports what conflicts.

`motte release <ref>` for the other half: putting work back deliberately rather than by editing state and hoping the next agent notices.

## Plan

1. `IssueStore.claim(id, author)` — refuses when assigned to somebody else and started
2. Refuse rather than steal: `--force` exists for a human who knows the other agent is gone
3. `motte release <ref>` clears the assignee and returns it to the default state
4. `claim_issue` and `release_issue` MCP tools, named as the first step after `ready_issues`
5. Update the AGENTS.md block: claim before working, release if you abandon it
6. Tests: two claims in a row, claiming your own, claiming settled work, the --force path

## Notes

### 2026-08-05T16:20:31Z — claude (agent)

claim and release on the store, with ClaimedError so a caller can tell 'taken' from 'missing' and try the next issue. Compare-and-set within one working tree, which is the case that matters; across branches git stays the arbiter.

Two behaviours the tests corrected. Claiming an issue already in a started state left it there rather than moving it — Blocked is a started category in this project's own config, and claiming must not quietly reinterpret it as In Progress. And re-claiming your own work keeps the stored spelling of your name, so a retry costs no write and records no transition.

Verified through both surfaces: over the CLI, atlas claims, nova is refused with exit 1, nova asks next and gets different work, atlas releases, nova takes it. Over MCP the refusal comes back as isError with the holder named, which is what lets an agent recover rather than stall. The AGENTS.md block and the MCP instructions now put claiming first, since it is the step an agent skips unless told — and skipping it is exactly what puts two of them on one issue.
