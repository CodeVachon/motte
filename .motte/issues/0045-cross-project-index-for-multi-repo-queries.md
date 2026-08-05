---
id: 45
title: Cross-project index for multi-repo queries
state: Done
labels: [core, agents]
created: 2026-07-29T17:12:32Z
updated: 2026-08-05T15:13:52Z
---

## Description

A per-machine registry at ~/.motte/index.db tracking every project motte has initialised or opened, so questions no single repo can answer become possible: what is assigned to me everywhere, what is in flight across all my projects, where did I leave off.

This is additive rather than a mirror — it holds data the committed files structurally cannot, which is what makes it worth a database.

## Plan

1. Register a project root on init and on any command run inside one
2. Store only the cross-project summary, not issue bodies
3. motte projects, and a --all flag on status and list
4. Tolerate a registered project that has moved or been deleted

## Notes

### 2026-08-05T15:13:52Z — claude (agent)

Built as ~/.motte/projects.json rather than the index.db the issue asked for, and the reasoning is in the module: it is one summary row per project, a few dozen on a busy machine, and SQL buys nothing at that size. It also has to be testable, and bun:sqlite is a Bun global while vitest runs on Node — the trap this project has fallen into repeatedly — while node:sqlite is still experimental. A file a person can read and repair is the same bargain the issue format makes. The cost is stated plainly: two processes registering in the same instant can lose one update, writes are atomic so the file is never torn, and a lost registration self-heals on the next command.

Plan step 1 needed a correction that only showed up in a test. Registering from context() recorded the backlog as it was *before* the command ran, so 'motte move 1 done' stored the state without the move and the registry was permanently one command behind. It now records on the way out of main(), with a fresh store, and init registers the project it just created rather than waiting for the next command.

motte projects, status --all and list --all all work from outside a project, which is most of the point. Verified by hand across three projects: 'list --all --assignee atlas' answered the headline question across two of them.

Two things found by looking at my own registry rather than at the tests. A stale premise in one test (a project with only Done work correctly does not appear under --open), and a real leak: the EPIPE test spawns a shell pipeline directly and built its environment by hand, so it wrote temp-directory projects into the real ~/.motte/projects.json. The sandbox is now one exported helper that every spawn takes, and a full suite run leaves only this repository's own entry.
