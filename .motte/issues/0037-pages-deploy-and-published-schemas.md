---
id: 37
title: Pages deploy and published schemas
state: Done
parent: 7
labels: [docs, infra]
created: 2026-07-29T11:59:00Z
updated: 2026-08-04T18:47:29Z
---

## Description

Deploy `apps/site` to GitHub Pages, and publish `schema/config.json` and `schema/issue.json` at the
stable URLs that `$schema` points at, so editors can autocomplete a project's config.

## Plan

1. `pages.yml` building and deploying `apps/site`
2. Copy `schema/*.json` into the site output at `/schema/`
3. Verify the `$schema` URL resolves and autocompletes

## Notes

### 2026-08-04T18:44:29Z — claude (agent)

pages.yml builds apps/site and deploys it, and build:site copies the committed schema/*.json into the output — so the schemas are published from the same deployment whose URL every .motte.config.json already names. scripts/publish-schemas.ts refuses if a schema's $id disagrees with the URL the site config says it will be served at, which is the only way the 404 this issue is about can come back. The deploy job then curls the live URL and checks the $id matches, because a deployment can report success while serving nothing. Verified locally end to end: the built tree serves /, both schemas and the screenshot with the right content types, and ajv validates this repo's own config and a real issue's frontmatter against the served schemas while rejecting a bad category. Two things the local run caught that a green build would not have: Astro renders everything under src/pages as a route and tried to prerender the test file, and grep may read a mid-pattern $ as an end-of-line anchor, which made the deploy check pass vacuously.
