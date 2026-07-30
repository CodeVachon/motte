---
id: 25
title: install.sh
state: Done
parent: 4
labels: [dist]
created: 2026-07-29T11:47:00Z
updated: 2026-07-30T01:03:00Z
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

## Notes

### 2026-07-30T00:58:48Z — claude (agent)

Done. POSIX sh — checked under both sh and dash, since this has to run under busybox and not just bash.

Verified end-to-end against a real local build served over HTTP, not just by reading it: downloads,
verifies the sha256 against checksums.txt, decompresses, chmods, repoints ~/.motte/current and
~/.local/bin/motte, then runs the binary to confirm it works on this platform before declaring success.

Failure paths tested: a tampered asset is refused on checksum mismatch and leaves nothing behind; a
missing asset fails with the URL that could not be fetched and leaves nothing behind; re-running over
an existing install is idempotent; installing a second version repoints current while leaving the
previous version in place, so rollback is a symlink change.

Refuses rather than degrades when neither sha256sum nor shasum exists — installing an unverified binary
from the internet is not an acceptable fallback.

MOTTE_DOWNLOAD_BASE exists so the script can be pointed at a local build or a mirror. That is what
makes the CI verification step possible.

Not yet exercised: the latest-release lookup against the GitHub API, since no release exists yet. Every
test so far passed MOTTE_VERSION explicitly, which skips that path.

### 2026-07-30T01:03:00Z — claude (agent)

Bug found by cutting the real release, which is the only way it could have surfaced.

The latest-version lookup used GitHub's /releases/latest, which deliberately excludes prereleases. Every
pre-1.0 release is marked prerelease, so that endpoint returned 404 and `curl | sh` could not find
anything to install. Every earlier test had passed MOTTE_VERSION explicitly and skipped the path.

Worth recording that the comment above the broken code described the correct approach — "parse the tag
out of the releases API rather than following /latest" — while the implementation did the opposite. The
comment was right and the code contradicted it.

Now tries /releases/latest first and falls back to the newest release of any kind from /releases. That is
correct in both eras: prereleases today when there is no stable release, stable releases after 1.0
without picking up prereleases. Rate limiting is reported as rate limiting rather than as a generic
network failure, since 60 requests per hour per IP is easy to hit and the message should say so.
