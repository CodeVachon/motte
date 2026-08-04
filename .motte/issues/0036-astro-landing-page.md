---
id: 36
title: Astro landing page
state: Done
parent: 7
labels: [docs, web]
created: 2026-07-29T11:58:00Z
updated: 2026-08-04T18:36:17Z
---

## Description

A single-page Astro site: what motte is, the install one-liner, a short command tour, and a
screenshot of `motte serve`.

## Plan

1. Astro scaffold in `apps/site`
2. Hero with the install one-liner and a copy button
3. Command tour and a serve screenshot

## Notes

### 2026-08-04T18:36:16Z — claude (agent)

Astro 7 in apps/site, one page, plain CSS on the same oklch tokens the web UI uses. Screenshot captured from motte serve against this repo's own backlog. Two layout bugs found by looking at the rendered page rather than the build output: Prettier indents <code> inside <pre>, and a pre honours that, so every sample rendered with 36 spaces of leading whitespace that the horizontal scroll then hid — fixed by collapsing whitespace on the wrapper and preserving it on the block-level code, which makes the markup's own formatting irrelevant. And the install rows took the whole page into horizontal scroll on a phone, because neither a grid item nor a flex item shrinks below its content width without min-width: 0. A test asserts the install one-liners match the ReadMe and point at installers that exist, and that the schema links come from the configured base rather than a hardcoded /motte/.
