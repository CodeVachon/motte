---
id: 60
title: motte watch — live dashboard
state: Todo
labels: [cli, dx]
created: 2026-07-30T12:14:15Z
updated: 2026-07-30T12:14:15Z
---

## Description

A terminal dashboard that updates as issues change, so you can watch work move without re-running `motte status`.

The motivating case is several agents working at once: seeing that one just started an issue and another just finished one, as it happens. That is the moment a static snapshot stops being enough.

Deliberately terminal-native rather than a browser tab. `motte serve` (#0006) already covers the browser; this is for the window you already have open beside your editor.

## Plan

1. File watcher in core, with coalescing (#0061)
2. Transition detection — what actually changed between snapshots (#0062)
3. The dashboard itself, and behaving correctly when stdout is not a terminal (#0063)
