---
id: 56
title: Event schema and append path
state: Todo
parent: 55
labels: [core]
created: 2026-07-29T20:16:00Z
updated: 2026-07-29T20:16:00Z
---

## Description

NDJSON shards under `.motte/events/`, one JSON object per line, written by every mutation that goes
through `IssueStore`.

```
.motte/events/2026-07.claude.ndjson
.motte/events/2026-07.christopher-vachon.ndjson
```

Sharded by month **and actor**. The month bounds file size and makes pruning a file operation. The
actor half is the important one: two agents on two branches never write the same file, so
append/append merge conflicts become structurally impossible rather than merely rare. Readers
merge-sort by timestamp across shards.

An event is a transition, not a snapshot:

```json
{"at":"2026-07-29T16:04:09Z","type":"state","id":48,"by":"claude","as":"agent","from":"In Progress","to":"Done"}
```

Types: `created`, `state`, `assigned`, `parent`, `blocked`, `unblocked`, `title`, `pruned`.

## Plan

1. `EventSchema` in core, with a `type` discriminator
2. Append from the single writer path in `IssueStore`, so no surface can mutate without recording
3. Skip no-op transitions — a `move` to the state an issue is already in records nothing
4. Actor slug from the resolved author, reusing `resolveAuthor` and `slugify`
5. Reader that merge-sorts shards by timestamp, tolerating a malformed line rather than failing
6. `events.enabled` in config, defaulting on; no retention settings, since pruning is manual

## Notes

### 2026-07-29T20:16:00Z — claude (agent)

Appending from `IssueStore` rather than from the CLI is deliberate. The CLI, the MCP server and the
web API all mutate through the store, so recording there means no surface can change an issue without
the transition being logged. Doing it per-surface would guarantee drift.

A malformed line must not break a read. The log is a convenience over the issue files, which remain
the source of truth — a corrupt shard should degrade reporting, never block work.
