---
id: 7
title: Landing page and docs
state: Done
labels: [docs, web]
created: 2026-07-29T11:26:00Z
updated: 2026-08-04T18:53:32Z
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

### 2026-08-04T18:53:32Z — claude (agent)

Live at https://codevachon.github.io/motte/. Pages enabled with the Actions source, deploy green, and verified independently of CI: the page, both schemas and the screenshot all serve with the right content types, the served schema bytes are identical to the committed ones, and ajv validates this repo's own .motte.config.json and a real issue's frontmatter against the published URLs while rejecting an invalid state category. The $schema field motte has been writing since 0.1.0 finally resolves.
