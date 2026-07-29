---
id: 26
title: install.ps1
state: Todo
parent: 4
labels: [dist]
created: 2026-07-29T11:48:00Z
updated: 2026-07-29T11:48:00Z
---

## Description

PowerShell equivalent of `install.sh` for Windows, invoked with `irm … | iex`. Same versioned
layout, but adds to the user `PATH` instead of relying on `~/.local/bin`.

## Plan

1. Download and checksum-verify `motte-windows-x64.exe`
2. Install to `$env:USERPROFILE\.motte\versions\v<X.Y.Z>\bin\`
3. Update the user `PATH` and the `current` junction
