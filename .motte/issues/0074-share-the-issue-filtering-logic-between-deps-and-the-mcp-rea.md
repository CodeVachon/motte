---
id: 74
title: Share the issue-filtering logic between deps and the MCP reads
state: Todo
parent: 67
labels: [health, cli, mcp]
created: 2026-07-30T18:04:25Z
updated: 2026-07-30T18:04:25Z
---

## Description

fallow finds two clone groups, 17 lines, between commands/deps.ts and mcp/tools/reads.ts: the state, label and assignee filters are written out twice, character for character.

Not in #0066's list — that named the subtree scoping shared between status and the MCP tree tool, which is done. This pair surfaced afterwards, once the dead code was gone and it was the only duplication left outside the pre-existing config/serialize safeParse pair.

## Plan

1. A predicate in core taking { state, label, assignee } and an issue
2. Both call sites use it; check the two are semantically identical first, including case handling, rather than assuming from the clone report
3. Confirm the clone groups drop to the one pre-existing safeParse pair
