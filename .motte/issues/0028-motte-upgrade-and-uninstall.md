---
id: 28
title: motte upgrade and uninstall
state: Done
parent: 4
labels: [dist, cli]
blockedBy: [27]
created: 2026-07-29T11:50:00Z
updated: 2026-07-30T01:21:46Z
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

### 2026-07-30T01:21:46Z — claude (agent)

Done. motte upgrade [target] [--check] [--keep N] [--force] and motte uninstall [--yes] [--keep-cli].

Verified against the real published v0.1.0 release, not just a local server: an older build correctly
reported v0.1.0 as available and upgraded into it, GitHub API lookup included, with update-check.json
written.

Design decision: upgrade reimplements download-verify-unpack-symlink in TypeScript rather than shelling
out to install.sh. One code path then covers every platform including Windows, where there is no sh. The
cost is two implementations of the same layout, so layout.test.ts reads install.sh and asserts the asset
naming, directory shape, environment overrides and checksum-before-install ordering still match. That
check is what makes the duplication safe — a silent divergence would mean curl-pipe-sh and motte upgrade
installing to different places.

Three bugs found while testing, each worth recording.

The positional was named `version`, which collides with yargs' built-in --version flag. The flag wins, so
args.version arrived as the boolean true and normalizeVersion threw "trim is not a function". Renamed to
`target`.

--keep 1 silently left two versions on disk. The running binary's version is deliberately never pruned,
because deleting a running executable is harmless on Unix but fails outright on Windows where the file is
locked. Ignoring the flag without saying so looked like a bug, so pruneVersions now reports what it kept
and why, and notes that the next upgrade will remove it.

vitest runs on Node, so Bun globals are undefined in tests. download.ts originally used Bun.CryptoHasher
and Bun.gunzipSync, which made it impossible to test at all. Switched to node:crypto and node:zlib, which
work identically under Bun. Recorded in AGENTS.md, since it applies to any library code in this repo.

uninstall never touches a project's .motte/ backlog — only the installation under ~/.motte and symlinks
that actually resolve into it. A motte on PATH from somewhere else is not ours to delete. Verified that a
project backlog survives uninstall --yes. --keep-cli reports honestly that agent wiring does not exist
yet (#0031) rather than claiming success for work never done.
