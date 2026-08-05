---
id: 85
title: motte claim — refuse the second agent rather than letting both start
state: Todo
parent: 83
labels: [cli, core, agents]
created: 2026-08-05T15:49:57Z
updated: 2026-08-05T15:49:57Z
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
