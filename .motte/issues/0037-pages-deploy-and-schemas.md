---
id: 37
title: Pages deploy and published schemas
state: Todo
parent: 7
labels: [docs, infra]
created: 2026-07-29T11:59:00Z
updated: 2026-07-29T11:59:00Z
---

## Description

Deploy `apps/site` to GitHub Pages, and publish `schema/config.json` and `schema/issue.json` at the
stable URLs that `$schema` points at, so editors can autocomplete a project's config.

## Plan

1. `pages.yml` building and deploying `apps/site`
2. Copy `schema/*.json` into the site output at `/schema/`
3. Verify the `$schema` URL resolves and autocompletes
