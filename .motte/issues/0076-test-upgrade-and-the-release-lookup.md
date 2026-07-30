---
id: 76
title: Test upgrade and the release lookup
state: Done
parent: 4
labels: [cli, testing, dist]
created: 2026-07-30T18:13:08Z
updated: 2026-07-30T18:25:18Z
---

## Description

upgrade.ts and install/releases.ts hold four more of the highest CRAP scores — 182, 110, 72 and 56 — all at 0% coverage.

resolveLatestVersion is the one that has actually broken: /releases/latest excludes prereleases, so it 404s while motte is pre-1.0 and the fallback is the only path that finds anything. That broke the hosted installer on the first real release. install.sh and this function have to agree, and nothing checks that they do.

## Plan

1. resolveLatestVersion against a stubbed global fetch: stable release found, 404 falling back to the newest prerelease, drafts skipped, nothing at all, and an unreachable API
2. candidateBinLinks and recordCheck as units — both are pure enough given MOTTE_BIN_DIR and MOTTE_INSTALL_DIR
3. locateInstall already takes an execPath, so a managed install can be faked without touching the real one
4. Do not make the upgrade handler perform a real download; the seam is fetchVerifiedBinary, already covered by download.test.ts

## Notes

### 2026-07-30T18:25:18Z — claude (agent)

Done, and it found a real bug — which is the argument for having written it rather than just moving a
coverage number.

install/releases.ts goes from 0% to 100% statements and 96.9% branches, 13 tests against a stubbed global
fetch. No env seam had to be added to production code: api() calls global fetch, so vi.stubGlobal reaches it.
Covered both API calls in order and the URLs asked for, the 404-then-list fallback that is the only working
path while motte is pre-1.0, drafts skipped, an empty list, a non-200 list, a non-JSON body, rate limiting on
either call, a 403 that is not a rate limit, and an unreachable API.

commands/upgrade.ts goes from 0% to 46.3%, and its handler drops from CRAP 182 to out of the findings; the
file's worst is now 72. 10 tests. locateInstall derives the install from process.execPath, and that property
turns out to be redefinable, so a managed installation can be faked by laying out
<root>/versions/<version>/bin/motte and pointing execPath at it. The download path is deliberately left
alone, as the plan said: its seam is fetchVerifiedBinary, already covered against a local HTTP server in
download.test.ts.

The bug. resolveLatestVersion's result was never passed through normalizeVersion, while an explicitly passed
version was. normalizeVersion ADDS the leading v — the canonical internal form is vX.Y.Z, and
compareVersionsDescending's regex is anchored on ^v — so a release tagged 0.3.0 rather than v0.3.0 parsed as
0.0.0, and a strictly newer version was reported as a downgrade. `motte upgrade` would have printed
"0.3.0 is older than the running 0.2.0" and then installed it anyway. One-line fix; verified by reverting it
and watching the test fail.

install.sh does not have this gap — it normalizes after latest_version(), so the shell installer was right
and the TypeScript had drifted from it. That is exactly the parity this issue was worried about, just in the
opposite direction from the one I expected.

Worth recording how it surfaced, because the first version of that test passed while the bug was present. I
had asserted only upToDate === false, which was true — but for the wrong reason, since a downgrade is also
not up to date. Adding isDowngrade === false is what turned a green test into a failing one. Three of my
other assertions were inverted the same way, expecting normalizeVersion to strip the v rather than add it;
those failed loudly and were quick to fix.

Where prune and upgrade leave the project: score 78.5 from 77.9, critical findings 8 to 4, functions over
threshold 21 to 16. prune.ts is off the per-file risk list entirely, having been top of it at 420. The
remaining CRAP leaders are install.ts 342, log.ts 193.9, show.ts 165.4 and mutate.ts 132 — install.ts being
the agent-wiring command, and the other three being the display-heavy handlers.
