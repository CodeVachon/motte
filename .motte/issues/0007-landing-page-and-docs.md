---
id: 7
title: Landing page and docs
state: Todo
labels: [docs, web]
created: 2026-07-29T11:26:00Z
updated: 2026-07-29T11:26:00Z
---

## Description

An Astro site deployed to GitHub Pages that explains what motte is, carries the install one-liner,
and hosts the published JSON Schemas at the stable URLs referenced by `$schema`.

## Plan

1. Astro scaffold in `apps/site` with install instructions and a short tour
2. GitHub Pages deploy workflow
3. Publish `schema/config.json` and `schema/issue.json` at stable paths

## Notes

### 2026-07-29T11:26:00Z — claude (agent)

Start on `codevachon.github.io/motte`. A vanity domain like `motte.sh` is a later Pages config
change plus updated `$schema` URLs.
