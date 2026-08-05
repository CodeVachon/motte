---
id: 84
title: motte next — the single best issue to pick up
state: Todo
parent: 83
labels: [cli, core, agents]
created: 2026-08-05T15:49:57Z
updated: 2026-08-05T15:49:57Z
---

## Description

`motte ready` answers 'what could be started'. The question an agent actually has is 'what should I start', and today the answer is whichever issue happens to have the lowest id.

Every signal needed is already on disk. How many issues a candidate transitively unblocks is the strongest — finishing a blocker is what lets other work begin, which is exactly what `motte watch` was built to show. Depth in the tree matters too: taking leaves first is what actually closes epics. Age breaks ties, and an issue already assigned to the caller should win over one that is not.

The ordering has to be explainable. A recommendation nobody can argue with is a recommendation nobody trusts, so `--why` should say what put an issue first.

## Plan

1. A pure `rank(config, issues, options)` in core over the dependency DAG and the tree
2. Weigh: transitive dependents, tree depth, age, assignee match; document why each is there
3. `motte next` prints one issue, `--limit` a few, `--why` the reasoning, `--json` for agents
4. A `next_issue` MCP tool, and a mention in the AGENTS.md block that `next` follows `ready`
5. Tests over hand-built graphs: a long chain, a wide fan-out, ties, and everything blocked
