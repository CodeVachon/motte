---
id: 59
title: motte restore
state: Done
parent: 55
labels: [cli, core]
blockedBy: [58]
created: 2026-07-29T20:19:00Z
updated: 2026-07-30T13:48:56Z
---

## Description

Bring a pruned issue back from its tombstone. Without this, `motte prune` is deletion with extra
steps — the tombstone only means something if there is a command that acts on it.

```
motte restore 12
motte log --pruned      # what tombstones exist
```

Reads the `pruned` event, recovers the file content from the recorded commit, and writes it back.

## Plan

1. Find the tombstone for an id, erroring clearly if there is none
2. `git show <commit>:<path>` to recover the content
3. Refuse if the id has been reused since, rather than overwriting a live issue
4. Write the file back, and append a `restored` event
5. Fall back to `git log --all --diff-filter=D -- <path>` when the commit is unreachable
6. Warn that the issue's own events are gone — only the tombstone survived

## Notes

### 2026-07-29T20:19:00Z — claude (agent)

Two failure modes need handling rather than a stack trace.

The id may have been reused. Ids come from `max(existing) + 1` over the files on disk, so pruning the
highest-numbered issue frees its number for the next `motte add`. Restoring then collides with a live
issue. Restore must detect that and refuse, and this is also an argument for `prune` warning when it
would free the top id.

The commit may be unreachable after a history rewrite. Fall back to searching for the deletion by
path, and if that fails too, say plainly that the content is unrecoverable rather than half-restoring
something.

Restoring cannot bring back the pruned events, only the issue. Worth stating in the output, since a
restored issue with no history looks like a bug otherwise.

### 2026-07-30T13:48:56Z — claude (agent)

Done, alongside #0058 — the two are useless apart, since a tombstone nothing acts on is just deletion
with extra steps.

motte restore <id> finds the tombstone, recovers the content with git show, writes the file back and
records a restored event. motte log --pruned lists what can be brought back, because nothing else would
surface a tombstone.

Both failure modes are handled rather than left to a stack trace. A reused id is refused with the git
command to recover the content by hand — ids come from max(existing) + 1, so pruning the
highest-numbered issue frees its number for the next motte add, and restoring over a live issue would
overwrite real work. An unreachable commit falls back to searching for the deletion by path across all
refs, and if that fails too it says plainly that the content is unrecoverable rather than half-restoring
something.

The output states that the issue's own events are gone and only the tombstone survived, because a
restored issue with no history otherwise looks like a bug.
