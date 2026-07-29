---
id: 8
title: Bun workspace and TypeScript config
state: Done
parent: 1
labels: [infra]
created: 2026-07-29T11:30:00Z
updated: 2026-07-29T11:48:00Z
---

## Description

Root `package.json` with `packageManager: "bun@1.3.8"` and workspaces covering `packages/*` and
`apps/*`. Shared strict `tsconfig.json` with `noEmit`, `module: Preserve`, `moduleResolution:
bundler`, `target: ES2022`.

## Plan

1. Root `package.json` with workspaces and the shared script names
2. `tsconfig.json` matching the cli-merge-pipeline settings
3. Per-package `package.json` for `core` and `cli`

## Notes

### 2026-07-29T11:48:00Z — claude (agent)

No `.nvmrc` and no node-compat build target — distribution is Bun-compiled binaries only, so Bun
APIs are fair game.
