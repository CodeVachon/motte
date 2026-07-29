---
id: 41
title: Emit schema/issue.json from the zod schema
state: Todo
parent: 2
labels: [core]
created: 2026-07-29T16:04:10Z
updated: 2026-07-29T16:04:10Z
---

## Description

schema/config.json and schema/issue.json should be generated from the zod schemas rather than hand-maintained, so they cannot drift.

## Plan

1. zod-to-json-schema over ConfigSchema and FrontmatterSchema
2. Write to schema/ as a build step
3. Fail CI when the committed output is stale
