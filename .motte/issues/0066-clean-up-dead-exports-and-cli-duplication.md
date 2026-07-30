---
id: 66
title: Clean up dead exports and CLI duplication
state: Todo
labels: [health]
created: 2026-07-30T14:27:04Z
updated: 2026-07-30T14:27:04Z
---

## Description

fallow found ten dead-code items and six small clone groups. None are urgent; together they are the difference between a B and an A on the health score.

Genuinely dead: byId in commands/list.ts, and IssueStore.openBlockers — both verified as having no callers anywhere. The rest is over-exporting: internals made public for no reason, which inflates the apparent API surface.

## Plan

1. Delete byId and IssueStore.openBlockers
2. Un-export what is only used within its own module: candidateBinLinks, NotInstalledError, COMPLETION_FLAG, recordPath, ReleaseLookupError, INSTRUCTIONS, NO_PROJECT, stateWidth
3. Collapse the two shard-rewriting functions in commands/prune.ts, which differ only in an early return
4. Share the subtree-scoping logic duplicated between commands/status.ts and mcp/server.ts
5. Re-run fallow analyze to confirm zero dead-code findings
