---
id: 27
title: Cross-compile release workflow
state: Done
parent: 4
labels: [dist, infra]
created: 2026-07-29T11:49:00Z
updated: 2026-07-30T00:58:48Z
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

## Notes

### 2026-07-30T00:58:48Z — claude (agent)

Done. scripts/build-release.ts cross-compiles all five targets from one runner — Bun does not need a
build matrix — then gzips each binary and writes checksums.txt.

Measured: darwin-arm64 58MB, darwin-x64 63MB, linux-x64 98MB, linux-arm64 93MB, windows-x64 110MB.
All five in 16 seconds. Gzip brings them to about 37% of raw, which is the difference between a 450MB
release and a 165MB one for two extra lines in the installer, so assets ship compressed.

Checksums cover the .gz that is actually downloaded, so verification happens before decompression.
gzip carries its own CRC, so a corrupt decompression is caught separately by gunzip.

The workflow refuses to build when the git tag disagrees with package.json, because a release that
reports the wrong version is worse than a failed release. It also smoke-tests the linux binary it just
built — init, add, doctor — and runs install.sh against the built assets over a local HTTP server, so
the installer is exercised on every release rather than only by hand.

Also fixed a real drift risk this surfaced: VERSION was hardcoded in index.ts, duplicated from
package.json. It now comes from a JSON import, which Bun inlines at compile time, so it cannot drift.
Verified that changing package.json moves both the dev run and the compiled binary.
