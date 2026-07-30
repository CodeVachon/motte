---
id: 26
title: install.ps1
state: Done
parent: 4
labels: [dist]
created: 2026-07-29T11:48:00Z
updated: 2026-07-30T18:44:14Z
---

## Description

PowerShell equivalent of `install.sh` for Windows, invoked with `irm … | iex`. Same versioned
layout, but adds to the user `PATH` instead of relying on `~/.local/bin`.

## Plan

1. Download and checksum-verify `motte-windows-x64.exe`
2. Install to `$env:USERPROFILE\.motte\versions\v<X.Y.Z>\bin\`
3. Update the user `PATH` and the `current` junction

## Notes

### 2026-07-30T18:44:14Z — claude (agent)

Done, and it is the first time anything about Windows has been executed — including the binary the release
workflow has been cross-compiling since v0.1.0, which had never been run.

install.ps1 mirrors install.sh on the versioned layout, the two-step version lookup, and
MOTTE_VERSION / MOTTE_INSTALL_DIR / MOTTE_NO_MODIFY_PATH / MOTTE_DOWNLOAD_BASE. Three departures, each
commented where it happens rather than only here:

A junction, not a symlink, for `current` — symlinks need administrator rights or developer mode on Windows,
junctions do not. That is also why `current` points at the version directory and the PATH entry reaches
through it, rather than linking the exe itself: junctions are directory-only.

The user PATH gains <root>\current\bin instead of a link in ~/.local/bin. There is no Windows equivalent of
that convention, so MOTTE_BIN_DIR does not exist here. Deliberate divergence, documented in the header.

GZipStream does the decompression. PowerShell has no gunzip and Expand-Archive only handles zip.

No param() block, because `irm | iex` evaluates the script as a statement block where a parameter block
either binds nothing or errors. Every input arrives through the environment, which is also what install.sh
does.

Verification is the honest part of this. There is no PowerShell on macOS, so I could not run, or even
parse-check, a single line locally. The windows-installer CI job is the entire story: 14 helper tests, then
a real install of the published v0.2.0, asserting `current` is genuinely a Junction and that the PATH entry
reaches the binary through it, then the binary running init, add, move, show --json and doctor, then a
second install checking MOTTE_NO_MODIFY_PATH is honoured.

Two things it caught. My first refusal tests called Assert-Checksum inline, but Stop-Motte calls exit, which
is not catchable and terminates a dot-sourcing host script — so the run died at the first refusal instead of
asserting on it. The installer was correct; the test could not observe it. They now run in a child pwsh and
check the exit code.

And reading the output rather than the exit code found a real bug: a freshly installed project reported
"1 issues, no problems found". doctor never pluralised, where list always has. Fixed with a test.

The gap I am leaving: the e2e step pins MOTTE_VERSION rather than resolving from the live API, so the
two-step lookup is not exercised end to end on Windows. That is deliberate — an unauthenticated API call
would make the job flakeable, and I spent #0072 removing exactly that kind of flake. Get-FirstTag, where the
parsing risk actually lives, is covered directly with recorded payloads including a 404 body and a
rate-limit body. If we want the live path covered, the clean way is a MOTTE_API_BASE seam in both installers,
mirroring MOTTE_DOWNLOAD_BASE, which exists for this reason.

Still untested anywhere: ARM64 Windows, where the note says the x64 build will be emulated. GitHub does not
offer an ARM64 Windows runner on the free tier.
