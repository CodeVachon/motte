---
id: 41
title: Emit schema/issue.json from the zod schema
state: Done
parent: 2
labels: [core]
created: 2026-07-29T16:04:10Z
updated: 2026-08-04T18:20:24Z
---

## Description

schema/config.json and schema/issue.json should be generated from the zod schemas rather than hand-maintained, so they cannot drift.

## Plan

1. zod 4 has z.toJSONSchema built in — no zod-to-json-schema dependency needed
2. scripts/emit-schemas.ts writes schema/config.json and schema/issue.json, committed because they are the published artefact
3. A test that regenerates in memory and compares against the committed files, so a zod change without a regenerate fails rather than drifting
4. $id set to the published URL the config files already reference

## Notes

### 2026-08-04T18:11:49Z — claude (agent)

Plan step 1 corrected: zod 4 ships z.toJSONSchema(), so the zod-to-json-schema package the plan named is not needed. One less dependency for a build step.

### 2026-08-04T18:20:24Z — claude (agent)

Generated and committed schema/config.json and schema/issue.json from the zod schemas via bun run schemas. The generator formats with Prettier rather than JSON.stringify, because the two disagree on short arrays and otherwise running the generator would leave format:check failing. A core test compares the committed files against a fresh projection and derives the required-field list from zod, so a schema change without a regenerate fails.
