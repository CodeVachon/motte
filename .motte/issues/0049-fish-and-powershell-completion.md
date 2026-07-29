---
id: 49
title: fish and PowerShell completion
state: Todo
parent: 46
labels: [cli, dist]
created: 2026-07-29T18:50:43Z
updated: 2026-07-29T18:50:43Z
---

## Description

yargs ships bash and zsh templates only. PowerShell matters because Windows is a supported install target via install.ps1.

## Plan

1. Hand-rolled fish completion calling motte --get-yargs-completions
2. Register-ArgumentCompleter block for PowerShell
3. Verify both in CI
