---
id: 35
title: Web asset embedding build step
state: Done
parent: 6
labels: [web, dist]
created: 2026-07-29T11:57:00Z
updated: 2026-08-04T17:44:54Z
---

## Description

Build `apps/web`, then generate `packages/cli/src/generated/webAssets.ts` with each file inlined as
base64 plus its content type.

Inlining rather than relying on Bun's embedded-file path resolution means the same code path works
when running from source and inside the compiled binary.

## Plan

1. `bun run build:web` — vite build, then codegen the asset module
2. Gitignore the generated file
3. Serve from the generated map, with correct content types and caching headers

## Notes

### 2026-08-04T17:44:53Z — claude (agent)

Done. `motte serve` from a compiled binary serves the interface with no flags and no files beside it.

Verified with the real thing rather than from source: built bin/motte, ran it in a fresh temp project with no
dist directory anywhere near it, and got the actual SPA — the board rendering the project's one issue in a
browser, the hashed asset served from inside the binary with its immutable cache header, no console errors,
and no placeholder warning.

Base64 for every asset including text. Emitting JS and CSS as template literals would have meant escaping
backticks and `${`, and getting that subtly wrong corrupts a bundle instead of failing loudly. 248 kB of
assets becomes 332 kB of base64 in a 62 MB binary.

The awkward part was the generated module being gitignored, which the plan asked for and which would normally
break typecheck: nothing can import a file that a fresh clone does not have. The fix is a committed
webAssets.d.ts beside the gitignored webAssets.ts. TypeScript resolves the import to the declaration when the
implementation is absent, so a clone typechecks and tests without ever running a web build, and the runtime
import is a dynamic one in a try/catch either way. Verified by moving the generated file away and running
both.

`bun build --compile` does bundle a dynamic import with a static specifier — that was the real risk in this
design and the reason the binary got tested rather than the source.

build:cli and build:release both depend on build:web now, so a binary cannot be produced without the
interface in it. That is the failure this issue existed to prevent: a release whose `motte serve` shows a
placeholder. The release workflow needed no change, since it goes through build:release.

Placeholder wording updated too: it now says the interface is not built into this binary, and that seeing the
page from a release means the embedding step did not run. The old text said the UI was still being written,
which stopped being true today.

One thing found while verifying, unrelated to embedding and filed as #0080: a tab left open on a server I had
stopped had logged 198 silent EventSource reconnects and still looked perfectly current. Showing a stale board
with no indication is the wrong failure for this tool.
