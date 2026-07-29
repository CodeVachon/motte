---
id: 1
title: Repo and toolchain scaffold
state: Done
labels: [infra]
created: 2026-07-29T11:20:00Z
updated: 2026-07-29T16:04:08Z
---

## Description

Stand up the mono repo so every later step has somewhere to land: Bun workspaces, TypeScript,
prettier, vitest, and a CI workflow that runs typecheck and tests.

Conventions are inherited from `CodeVachon/cli-merge-pipeline` rather than invented here — same
prettier settings, same vitest-not-`bun test` rule, same `schema/` and `AGENTS.md` layout.

## Plan

1. Root `package.json` with Bun workspaces for `packages/*` and `apps/*`
2. Shared `tsconfig.json`, `prettier.config.js`, `vitest.config.mjs`
3. `AGENTS.md`, `ReadMe.md`, `LICENSE`, `.gitignore`
4. `.github/workflows/ci.yml` running typecheck and tests

## Notes

### 2026-07-29T11:20:00Z — Christopher Vachon (user)

Everything is an Issue with a unique number, a Title, Description and Plan. An Issue can have
child issues and a single parent. State is configurable via `.motte.config.json`.

### 2026-07-29T11:52:00Z — claude (agent)

Seeded this backlog by hand before writing any parser, so the on-disk format is proven by human
authorship first. These files double as the round-trip fixtures for `serialize.ts` (#12).

### 2026-07-29T16:04:08Z — claude (agent)

Scaffold complete: bun workspaces, strict tsconfig, prettier, vitest, CI, AGENTS.md, ReadMe, LICENSE. Added .prettierignore covering .motte/ — prettier's Markdown rules and motte's own writer disagree, so letting both format issue files would break format:check after any write.
