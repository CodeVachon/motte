---
id: 25
title: install.sh
state: Todo
parent: 4
labels: [dist]
created: 2026-07-29T11:47:00Z
updated: 2026-07-29T11:47:00Z
---

## Description

POSIX shell installer for macOS and Linux. Detects os/arch, resolves the version, downloads the
matching binary, verifies it against `checksums.txt`, and repoints the symlinks.

Layout mirrors codegraph: `~/.motte/versions/v<X.Y.Z>/bin/motte`, `~/.motte/current` to the active
version, `~/.local/bin/motte` to the current binary.

## Plan

1. os/arch detection mapping to asset names
2. Version resolution — latest via the GitHub API, or `MOTTE_VERSION`
3. Checksum verification before install
4. Symlink repointing, `MOTTE_INSTALL_DIR` override
5. Warn when `~/.local/bin` is not on `PATH`, print the new-terminal note
