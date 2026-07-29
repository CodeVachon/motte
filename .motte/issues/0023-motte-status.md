---
id: 23
title: motte status
state: Done
parent: 3
labels: [cli, reports]
created: 2026-07-29T11:45:00Z
updated: 2026-07-29T16:04:10Z
---

## Description

The at-a-glance progress summary: a bar, counts by state, and the currently started work. This is
the command most likely to be run dozens of times a day, so it has to be fast and fit on one
screen.

## Plan

1. Progress bar and percentage from `reports.ts`
2. Counts by state, in configured order
3. List of issues in a `started` category state
4. `--json`
