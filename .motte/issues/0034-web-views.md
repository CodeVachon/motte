---
id: 34
title: Board, Tree, Issue detail, and Reports views
state: Todo
parent: 6
labels: [web]
created: 2026-07-29T11:56:00Z
updated: 2026-07-29T11:56:00Z
---

## Description

The four views. Board is a kanban by state with drag to change state. Tree shows the hierarchy with
drag to re-parent. Issue detail edits title, description, and plan inline and adds notes. Reports
renders the progress rollups.

## Plan

1. Board with drag-to-move
2. Tree with drag-to-re-parent, rejecting cycles
3. Issue detail with inline edit and note composer
4. Reports from `reports.ts`
5. Playwright pass over all four
