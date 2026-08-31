---
id: 99
title: configurable additional issue frontmatter fields
state: Done
labels: [core, cli, mcp, doctor, schema]
created: 2026-08-26T16:09:18Z
updated: 2026-08-31T13:25:30Z
---

## Description

Projects need structured, project-specific issue metadata such as a customer name or a reference URL. Add an optional config array of field definitions, each declaring a frontmatter key, human description, scalar value type, and whether every issue must supply it.

Configured fields must round-trip as first-class issue data. They need to be collected and changed through the CLI, visible and writable to agents through MCP, emitted in machine-readable output and JSON Schema, and checked by motte doctor. A malformed declaration, a missing required value, an unknown/typoed configured field, or a value with the wrong declared type must yield an actionable diagnostic without silently dropping user data.

Configured values must also be queryable: people and agents need to filter work by a declared key, for example customer=Sears, and request progress reports for that same scoped set rather than for the entire backlog.

## Plan

1. Define `issueFields` config declarations `{ key, description, type, isRequired }`; types text, URL, number, boolean, date; validate safe YAML keys, uniqueness, reserved collisions, descriptions/types; publish config schema.
2. Core parsing, typing, storage, replacement, and serialization validate dynamically while preserving values; `isRequired` applies on issue creation and whole-file edits.
3. Doctor validates config and per-issue missing, unknown/typoed, or mistyped custom fields with file/key context, without round-trip regressions.
4. CLI prompts for configured fields during interactive add; support repeatable `--field key=value` for add/edit, clearing optional values, and show/JSON output.
5. Filter CLI/MCP issue listing, ready/search/status, and scoped progress reports by typed custom fields (for example `customer=Sears`).
6. Extend MCP read/create/update contracts with field definitions plus a generic field map, and cover all behavior with tests and standard gates.

## Notes

### 2026-08-26T18:25:25Z — codex (agent)

Implemented configurable typed issue fields with config/schema validation, frontmatter preservation, doctor diagnostics, interactive and flag-based CLI entry points, scoped CLI reports, and MCP field contracts and filters. Full test and coverage runs each have one known unrelated OpenCode uninstall cleanup failure (1282/1283 pass); formatting, typecheck, and doctor pass.

### 2026-08-26T18:30:14Z — codex (agent)

Updated the public landing page to demonstrate typed custom frontmatter and customer-scoped status filtering; added a landing-page regression test.

### 2026-08-31T13:12:26Z — codex (agent)

Added the requested human-readable total issue count to status output; JSON already exposed report.total.
