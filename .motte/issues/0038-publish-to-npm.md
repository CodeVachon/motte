---
id: 38
title: Publish to npm
state: Cancelled
parent: 4
labels: [dist]
created: 2026-07-29T11:15:00Z
updated: 2026-07-29T11:19:00Z
---

## Description

Offer `npm i -g` and `npx` as an alternative install path alongside the shell installer.

## Notes

### 2026-07-29T11:17:00Z — claude (agent)

`motte` is already taken on npmjs.org by an unrelated database library. `@codevachon` is mapped to
GitHub Packages in `~/.npmrc`, which is auth-gated even for public reads, so a scoped publish there
would fail for everyone else. `motte-cli` is available as an alternative.

### 2026-07-29T11:19:00Z — Christopher Vachon (user)

Skip npm entirely. The shell installer and release binaries are the only install paths.
