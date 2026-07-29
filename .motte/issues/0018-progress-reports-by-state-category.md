---
id: 18
title: Progress reports by state category
state: Done
parent: 2
labels: [core, reports]
created: 2026-07-29T11:40:00Z
updated: 2026-07-29T16:04:09Z
---

## Description

Roll up completion using each state's `category` rather than its name, so a project that renames
its states still gets correct numbers. Report per-project and per-subtree, so an epic can show its
own progress.

Cancelled issues come out of the denominator — otherwise abandoned work permanently caps a project
below 100%.

## Plan

1. Counts by state and by category
2. Percent complete, excluding `cancelled` from the denominator
3. Per-subtree rollup for any issue with children
4. Tests across all four categories and a custom state list
