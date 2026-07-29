---
id: 35
title: Web asset embedding build step
state: Todo
parent: 6
labels: [web, dist]
created: 2026-07-29T11:57:00Z
updated: 2026-07-29T11:57:00Z
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
