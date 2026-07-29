---
id: 45
title: Cross-project index for multi-repo queries
state: Todo
labels: [core, agents]
created: 2026-07-29T17:12:32Z
updated: 2026-07-29T17:12:32Z
---

## Description

A per-machine registry at ~/.motte/index.db tracking every project motte has initialised or opened, so questions no single repo can answer become possible: what is assigned to me everywhere, what is in flight across all my projects, where did I leave off.

This is additive rather than a mirror — it holds data the committed files structurally cannot, which is what makes it worth a database.

## Plan

1. Register a project root on init and on any command run inside one
2. Store only the cross-project summary, not issue bodies
3. motte projects, and a --all flag on status and list
4. Tolerate a registered project that has moved or been deleted
