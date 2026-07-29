---
id: 44
title: Local SQLite mirror of the issue files
state: Cancelled
labels: [core, perf]
created: 2026-07-29T17:12:31Z
updated: 2026-07-29T17:12:31Z
---

## Description

A non-committed SQLite database mirroring `.motte/issues/*.md` in a structured form, so commands query the DB instead of re-parsing every file.

Measured and declined for now — it optimises a cost that is not the bottleneck at this tool's intended scale, in exchange for a second source of truth.

## Plan

Revisit only when a real project passes roughly 2,000 issues, where cold parse crosses 200ms.

If built, the constraints are non-negotiable:
1. Strictly derived and disposable — files remain the only source of truth
2. Rebuildable from scratch with one command
3. Every read path must work correctly with the DB absent or corrupt
4. Staleness validated by stat-ing every file, never by trusting a directory mtime
5. Gitignored

## Notes

### 2026-07-29T17:12:31Z — claude (agent)

Benchmarked on this machine (Bun 1.3.8, M-series, warm page cache).

Cold parse by backlog size: 100 issues 28ms · 500 75ms · 2,000 198ms · 10,000 860ms.

Where the time actually goes in a compiled binary at this repo's real size (43 issues): 72ms total wall clock, of which parse is 29ms. An index could remove at most that 29ms and would add roughly 5ms of open-and-query, so best case is 72ms to 48ms. Both are far below the threshold where anyone notices.

Two assumptions I held going in were wrong and are worth recording:
1. I expected staleness validation to be expensive enough to sink the idea. It is not — stat-ing every file costs about 1% of parsing them (25ms vs 2,459ms at 10,000 issues). An index is technically sound.
2. I expected full-text search to be the motivating case. It is not — an in-memory substring scan over 10,000 issues with 22MB of prose takes 7ms. SQLite FTS5 would not be felt.

The real reason to decline is not performance, it is that a mirror is a second source of truth. Git makes that worse than ordinary cache invalidation: checkout, rebase, stash and merge all rewrite files wholesale behind the DB's back.
