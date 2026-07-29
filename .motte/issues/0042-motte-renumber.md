---
id: 42
title: motte renumber
state: Todo
parent: 2
labels: [core]
created: 2026-07-29T16:04:11Z
updated: 2026-07-29T16:04:11Z
---

## Description

Two branches can each mint the same issue number, because ids come from a directory scan rather than a counter. doctor detects the collision; renumber has to repair it.

## Plan

1. Detect duplicate ids
2. Reassign the later file to a fresh id
3. Rewrite any parent references pointing at the reassigned id
4. Rename the file to match
