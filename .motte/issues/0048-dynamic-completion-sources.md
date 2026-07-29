---
id: 48
title: Dynamic completion sources
state: Todo
parent: 46
labels: [cli, dx]
created: 2026-07-29T18:50:43Z
updated: 2026-07-29T18:50:43Z
---

## Description

The completion values themselves, wired into yargs' completion hook.

## Plan

1. Issue refs — complete both the number and the title slug, since either resolves
2. Render zsh descriptions as `#0001 Build a login page [Todo]` via _describe
3. States from config for `move <ref> <TAB>`
4. Assignees observed in the backlog for `assign <ref> <TAB>`
5. Labels for --label

Completion must never write, and must never fail loudly — a broken backlog returns no candidates rather than spilling an error into the shell.
