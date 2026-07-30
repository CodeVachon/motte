---
id: 58
title: motte prune
state: Todo
parent: 55
labels: [cli, core]
blockedBy: [56]
created: 2026-07-29T20:18:00Z
updated: 2026-07-29T20:18:00Z
---

## Description

One operation across issues and events: drop settled issues past a cutoff, drop their events, and
append a `pruned` tombstone recording where the issue can be recovered from.

Never automatic. Pruning deletes committed history, so it happens only when someone asks for it, with
an explicit cutoff and no default.

```
motte prune --before 2026-01     # or --before 90d
motte prune --before 90d --dry-run
```

The tombstone is what makes this safe rather than destructive:

```json
{"at":"2026-07-29T20:18:00Z","type":"pruned","id":12,"by":"chris","as":"user",
 "title":"parseIssueFile and formatIssueFile round-trip","finalState":"Done",
 "path":".motte/issues/0012-parseissuefile-and-formatissuefile-round-trip.md",
 "commit":"b265730"}
```

## Plan

1. `--before <YYYY-MM | Nd>`, required — no default cutoff
2. `--dry-run` listing exactly what would go, and why anything eligible was skipped
3. Refuse on a dirty backlog (#0058 notes explain why)
4. Refuse to prune an issue any surviving issue still references
5. Remove the issue file, remove its events from the shards, append the tombstone
6. `--events-only` to reclaim space without removing issues

## Acceptance

- Pruning leaves `motte doctor` clean, by construction rather than by luck
- Every pruned issue is recoverable via its tombstone (#0059)
- A dry run changes nothing on disk
- Pruning with uncommitted changes under `.motte/` is refused, not warned about

## Notes

### 2026-07-29T20:18:00Z — claude (agent)

Three rules fall out of the tombstone having to be trustworthy, and they are the whole design.

Refuse on a dirty backlog. The tombstone records the commit the issue can be recovered from, which is
HEAD at prune time. If there are uncommitted changes under `.motte/`, that commit does not contain the
issue's current content, so the recorded pointer would silently recover a stale version. Refusing is
the only honest option. Prune should also be committed on its own, so the deletion and the tombstone
land together.

Refuse to prune an issue that a surviving issue still references, as parent or as blocker. Removing a
referenced issue would leave a dangling `parent` or `blockedBy`, which `doctor` reports as an error —
so an unrestricted prune would trade disk space for a permanently broken backlog. The alternative,
silently rewriting the survivor's references, destroys information in the survivor to save space in
something else. Refusing means you prune a whole settled subtree or none of it, and `doctor` stays
clean by construction. The dry run has to explain each skip, or this is merely frustrating.

Rewriting shards breaks the append-only property. That property is what makes the shards
merge-conflict-free during normal use, and prune is the one operation that violates it. Acceptable for
a deliberate, manually triggered maintenance step on a clean tree, but it is the reason prune must not
ever run automatically — an automatic rewrite of committed history during ordinary work would be a
genuinely bad idea.

### 2026-07-29T20:18:00Z — claude (agent)

Known limitation worth documenting rather than solving: a rebase or squash that rewrites history
invalidates the recorded commit. The tombstone therefore also records the file path, so recovery can
fall back to `git log --all --diff-filter=D -- <path>` to find where it went. If the commit is
genuinely gone, so is the issue — which is an argument for pruning rarely.
