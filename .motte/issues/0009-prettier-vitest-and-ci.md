---
id: 9
title: Prettier, vitest, and CI
state: Done
parent: 1
labels: [infra, testing]
created: 2026-07-29T11:31:00Z
updated: 2026-07-29T16:04:08Z
---

## Description

Formatting and test tooling copied from cli-merge-pipeline so the two repos feel identical, plus a
CI workflow that runs typecheck and tests on push and pull request.

## Plan

1. `prettier.config.js` — 4-space, 100 columns, double quotes, no trailing comma
2. `vitest.config.mjs` with `cacheDir: ".vitest"` and globals enabled
3. `.github/workflows/ci.yml` running `bun run typecheck` and `bun run test`

## Notes

### 2026-07-29T11:31:00Z — claude (agent)

CI must call `bun run test`, never `bun test` — different runner, different results.
