---
id: 77
title: Verify the Windows asset before publishing a release
state: Done
parent: 4
labels: [dist, infra]
created: 2026-07-30T19:01:17Z
updated: 2026-07-30T19:01:18Z
---

## Description

The release workflow verified install.sh against the freshly built assets but knew nothing about install.ps1, and the CI job that does exercise install.ps1 pins an already-published version — so it can never catch a newly broken Windows binary. Every release so far published a Windows asset that had never been run.

## Plan

1. Split the workflow into build, verify-windows, publish
2. Build once and pass the assets between jobs, so the published bytes are the tested bytes
3. Serve them locally in the Windows job and install with MOTTE_DOWNLOAD_BASE
4. Publish only if both platforms pass

## Notes

### 2026-07-30T19:01:18Z — claude (agent)

The ordering is the point. Verifying after publishing would mean a broken binary is already downloadable by
the time anyone finds out, so publish now needs both build and verify-windows.

Building once and passing the artifact between jobs rather than rebuilding per platform: the checksums only
mean something if the bytes that were tested are the bytes that get published. A rebuild could differ.

The Windows job serves dist/release over http and points MOTTE_DOWNLOAD_BASE at it, so the installer fetches
this release's assets rather than whatever is already on GitHub — the same trick the install.sh step has
always used.
