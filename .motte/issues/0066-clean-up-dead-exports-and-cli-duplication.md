---
id: 66
title: Clean up dead exports and CLI duplication
state: Todo
parent: 67
labels: [health]
created: 2026-07-30T14:27:04Z
updated: 2026-07-30T14:39:52Z
---

## Description

fallow found ten dead-code items and six small clone groups. None are urgent; together they are the difference between a B and an A on the health score.

Genuinely dead: byId in commands/list.ts, and IssueStore.openBlockers — both verified as having no callers anywhere. The rest is over-exporting: internals made public for no reason, which inflates the apparent API surface.

## Plan

1. Delete byId and IssueStore.openBlockers
2. Un-export what is only used within its own module: candidateBinLinks, NotInstalledError,
   COMPLETION_FLAG, recordPath, ReleaseLookupError, INSTRUCTIONS, NO_PROJECT, stateWidth
3. In commands/prune.ts, extract only the per-shard strip-and-rewrite loop that rewriteShards and
   rewriteShardsEventsOnly genuinely share. Do NOT merge the functions: rewriteShards also appends the
   `pruned` tombstones and rewriteShardsEventsOnly deliberately does not, because --events-only leaves
   the issues on disk. See the note below before touching this.
4. Share the subtree-scoping logic duplicated between commands/status.ts and mcp/server.ts
5. Re-run fallow analyze to confirm zero dead-code findings

## Notes

### 2026-07-30T14:39:24Z — claude (agent)

Correcting my own plan before anyone acts on it. Step 3 originally read that the two shard-rewriting
functions in commands/prune.ts "differ only in an early return". That is false, and following it literally
would have produced one of two bugs.

rewriteShards appends the `pruned` tombstone events. rewriteShardsEventsOnly deliberately does not,
because --events-only removes events while leaving the issues in place. The only thing that actually
differs trivially is the catch block.

Merging them naively gives either tombstones written during --events-only — so `motte restore` offers to
restore issues that were never pruned and are still on disk — or tombstones dropped from the real prune,
which breaks restore entirely and makes prune destructive. That is precisely the guarantee #0058 was built
to provide.

The shared part is real and worth extracting: the per-shard read, strip, rewrite-or-delete loop. The
tombstone append must stay in rewriteShards alone.

Caught by /code-review, which checked the claim against the code instead of taking the note at face value.
