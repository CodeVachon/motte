---
id: 27
title: Cross-compile release workflow
state: Todo
parent: 4
labels: [dist, infra]
created: 2026-07-29T11:49:00Z
updated: 2026-07-29T11:49:00Z
---

## Description

One GitHub Actions runner builds every platform, since Bun cross-compiles. Tag push produces a
release with five binaries and a `checksums.txt`.

## Plan

1. `bun build --compile --target=bun-<platform>` for darwin-arm64, darwin-x64, linux-x64,
   linux-arm64, windows-x64
2. Generate `checksums.txt`
3. Attach all assets to the GitHub Release
4. Smoke-test `install.sh` against the pre-release in a clean container
