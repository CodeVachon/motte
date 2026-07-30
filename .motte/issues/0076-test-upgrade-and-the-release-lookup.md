---
id: 76
title: Test upgrade and the release lookup
state: Todo
parent: 4
labels: [cli, testing, dist]
created: 2026-07-30T18:13:08Z
updated: 2026-07-30T18:13:08Z
---

## Description

upgrade.ts and install/releases.ts hold four more of the highest CRAP scores — 182, 110, 72 and 56 — all at 0% coverage.

resolveLatestVersion is the one that has actually broken: /releases/latest excludes prereleases, so it 404s while motte is pre-1.0 and the fallback is the only path that finds anything. That broke the hosted installer on the first real release. install.sh and this function have to agree, and nothing checks that they do.

## Plan

1. resolveLatestVersion against a stubbed global fetch: stable release found, 404 falling back to the newest prerelease, drafts skipped, nothing at all, and an unreachable API
2. candidateBinLinks and recordCheck as units — both are pure enough given MOTTE_BIN_DIR and MOTTE_INSTALL_DIR
3. locateInstall already takes an execPath, so a managed install can be faked without touching the real one
4. Do not make the upgrade handler perform a real download; the seam is fetchVerifiedBinary, already covered by download.test.ts
