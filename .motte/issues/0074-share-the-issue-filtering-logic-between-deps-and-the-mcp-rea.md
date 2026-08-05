---
id: 74
title: Share the issue-filtering logic between deps and the MCP reads
state: Done
parent: 67
labels: [health, cli, mcp]
created: 2026-07-30T18:04:25Z
updated: 2026-08-05T13:25:18Z
---

## Description

fallow finds two clone groups, 17 lines, between commands/deps.ts and mcp/tools/reads.ts: the state, label and assignee filters are written out twice, character for character.

Not in #0066's list — that named the subtree scoping shared between status and the MCP tree tool, which is done. This pair surfaced afterwards, once the dead code was gone and it was the only duplication left outside the pre-existing config/serialize safeParse pair.

## Plan

1. A predicate in core taking { state, label, assignee } and an issue
2. Both call sites use it; check the two are semantically identical first, including case handling, rather than assuming from the clone report
3. Confirm the clone groups drop to the one pre-existing safeParse pair

## Notes

### 2026-08-05T13:25:18Z — claude (agent)

filterIssues/matchesFilter now live in core and all three call sites use them — the issue named two, but motte list had a third copy. The 831 existing tests passed untouched, which is what makes this a refactor rather than a redefinition.

Plan step 2 earned its place. The three copies were not identical: list matches state by leading fragment for someone typing --state don, while the MCP tools match exactly, and collapsing that would either break the CLI or silently widen the tool contract. It is a parameter now, with both halves tested. Checking also cost me a wrong assumption I had written into three comments — prefix means a leading fragment, so --state prog does not find In Progress, and the test now says so explicitly.

Step 3 confirmed: clone groups are down to the one pre-existing config/serialize safeParse pair, and duplication from 0.66% to 0.099%. Two groups outside the issue's scope went with it. One was mine, introduced hours earlier — renumberFile arrived with its own copy of addNote's author resolution, now a private noteFrom helper. The other was block and unblock, twenty-one duplicated lines built from one description now, which the issue's own acceptance criterion required.
