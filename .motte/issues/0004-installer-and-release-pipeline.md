---
id: 4
title: Installer and release pipeline
state: Todo
labels: [infra, dist]
created: 2026-07-29T11:23:00Z
updated: 2026-07-30T19:01:18Z
---

## Description

Ship motte the way codegraph ships: a `curl -fsSL … | sh` one-liner that drops a single
self-contained binary into a versioned directory and symlinks it onto `PATH`. No npm, no runtime
prerequisite.

Scheduled ahead of the web UI on purpose. This is how the binary reaches the machine doing the
dogfooding, and shipping it early means many small exercises of the release path instead of one
risky one at the end.

## Plan

1. `install.sh` — detect os/arch, resolve version, verify checksum, repoint symlinks
2. `install.ps1` for Windows
3. `release.yml` cross-compiling five targets, attaching binaries plus `checksums.txt`
4. `motte upgrade` / `motte uninstall`, pruning to the last two versions

## Notes

### 2026-07-29T11:23:00Z — claude (agent)

Simpler than codegraph, which ships a 115 MB Node runtime plus a `lib/` tree and a shell shim per
version. A Bun-compiled binary is one file with no shim.

### 2026-07-30T19:01:18Z — claude (agent)

Release pipeline complete for the CLI: install.sh (#0025), install.ps1 (#0026), cross-compiled builds (#0027), upgrade and uninstall (#0028), and both platforms verified before publishing (#0077). Still open under this epic: #0049 fish and PowerShell completion, and #0035 web asset embedding, which waits on the web UI.
