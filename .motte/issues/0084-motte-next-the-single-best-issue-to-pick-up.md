---
id: 84
title: motte next — the single best issue to pick up
state: Done
parent: 83
labels: [cli, core, agents]
created: 2026-08-05T15:49:57Z
updated: 2026-08-05T16:20:31Z
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

## Notes

### 2026-08-05T16:20:31Z — claude (agent)

rankReady in core, lexicographic rather than weighted. Weights would need defending — why is unblocking two issues worth more than three days of age — and the answer would be invented; a sequence of comparisons can be stated in a sentence, which is what --why prints.

Order: the caller's own started work, then what a piece of work would unblock transitively, then depth in the tree, then age, then id for stability. Work assigned to somebody else is left out, which is the multi-agent point.

Two things the real backlog taught me that the plan did not anticipate. First, --why claimed 'longest waiting' for three issues at once, because breakdown files them in the same second; it now requires strictly oldest. Second, and more interesting: excluding any parent with unsettled children took out #0086, whose only child is blocked by it — so the parent held the work. The rule is now narrower and better stated: exclude a parent only when something under it could be started right now, because then that is the work and the parent is bookkeeping.

Also excluded assigned work when nobody says who is asking. My first test asserted the opposite; the safer reading won, since handing an agent work with another name on it is the one outcome this ordering exists to prevent.
