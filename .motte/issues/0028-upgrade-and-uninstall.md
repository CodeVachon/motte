---
id: 28
title: motte upgrade and uninstall
state: Todo
parent: 4
labels: [dist, cli]
created: 2026-07-29T11:50:00Z
updated: 2026-07-29T11:50:00Z
---

## Description

`upgrade` resolves the latest release, installs into a new version directory, repoints `current`,
and prunes to the last two versions. Rollback is just repointing a symlink.

`uninstall` removes the agent wiring and the CLI, with `--keep-cli` to remove only the wiring.

## Plan

1. `upgrade [--check] [<version>]` with a cached check in `~/.motte/update-check.json`
2. Prune to the last two version directories
3. `uninstall [--keep-cli]`, unwiring every agent it configured

## Notes

### 2026-07-29T11:50:00Z — claude (agent)

Pruning is a deliberate departure from codegraph, which keeps every version. These binaries carry
the whole Bun runtime, so the directory would grow fast.
