---
id: 60
title: motte watch — live dashboard
state: Done
labels: [cli, dx]
created: 2026-07-30T12:14:15Z
updated: 2026-08-05T14:29:09Z
---

## Description

A terminal dashboard that updates as issues change, so you can watch work move without re-running `motte status`.

The motivating case is several agents working at once: seeing that one just started an issue and another just finished one, as it happens. That is the moment a static snapshot stops being enough.

Deliberately terminal-native rather than a browser tab. `motte serve` (#0006) already covers the browser; this is for the window you already have open beside your editor.

## Plan

1. File watcher in core, with coalescing (#0061)
2. Transition detection — what actually changed between snapshots (#0062)
3. The dashboard itself, and behaving correctly when stdout is not a terminal (#0063)

## Notes

### 2026-08-05T14:29:09Z — claude (agent)

Complete. #0061 gave the watcher, #0062 the change detection, #0063 the dashboard. It does what the epic asked: a terminal window beside the editor that shows work moving, including the transition no log records — an issue becoming ready because somebody else closed its blocker.
