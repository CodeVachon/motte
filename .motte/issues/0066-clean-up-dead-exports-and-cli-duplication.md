---
id: 66
title: Clean up dead exports and CLI duplication
state: Done
parent: 67
labels: [health]
created: 2026-07-30T14:27:04Z
updated: 2026-07-30T18:04:26Z
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

### 2026-07-30T18:04:26Z — claude (agent)

All five plan steps done, and the dead-code check is the headline: fallow analyze now reports zero issues
across every category, from ten.

Both "genuinely dead" claims verified before deleting rather than taken from the report. byId in list.ts was
exported with no callers anywhere — and its doc comment claimed it was "shared by show and tree", which is
false and is probably why it read as alive. IssueStore.openBlockers had no `.openBlockers(` call outside its
own class; the widely-used openBlockers is the core function it delegated to, not the method, so the two are
easy to confuse in a grep. Removing the method made its import unused too.

Un-exported: candidateBinLinks, NotInstalledError, COMPLETION_FLAG, recordPath, ReleaseLookupError,
INSTRUCTIONS, NO_PROJECT, stateWidth. Two were not shaped as the plan assumed — NotInstalledError and
INSTRUCTIONS were declared unexported and re-exported at the bottom of their files, so only the re-export
needed removing.

Step 3, the prune one with the warning on it. Extracted stripEventsFromShards: the per-shard read, strip,
rewrite-or-delete loop, and nothing else. The tombstone append stays in rewriteShards alone, with a comment
saying why so the next reader does not merge them.

The 545 tests do not verify that, and it would have been wrong to claim they did — prune.ts is at 7%
coverage and nothing tests these two functions. So I checked it by hand end to end. A real prune wrote 2
tombstones and `motte restore 1` brought the issue back with its title intact. A --events-only prune left
the issue on disk, wrote zero tombstones, and restore correctly refused with "no tombstone was found for
#1". Both halves of the guarantee hold.

Step 4: subtreeOf now lives in core/tree.ts beside flattenTree, replacing an identical IIFE in the CLI tree
command and the MCP tree tool.

One honest caveat on the audit. It returns fail with 8 findings marked introduced, and none of them are
new. Every one has an identical score in the health measurement I took before starting this epic — prune 420,
upgrade 182, list 33, status 46.9, releases 110, candidateBinLinks 72. The attribution is an artifact of
touching the files: candidateBinLinks moved from column 7 to column 0 by losing its `export` keyword, and
the prune handlers shifted 20 lines down. In upgrade.ts and releases.ts the only diff is the word `export`;
status.ts's handler actually got simpler. I am not treating the fail as a blocker, and I would rather write
down why than quietly re-run until it passes.

Left behind deliberately: two clone groups between deps.ts and mcp/tools/reads.ts, filed as #0074.
