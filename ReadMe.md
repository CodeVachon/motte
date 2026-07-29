# motte

A lightweight project command center for small projects, where Linear, Jira, or even GitHub Issues
are complete overkill.

> A motte is the fortified command point of a small medieval domain. That maps nicely to a
> lightweight project command center.

Take a larger story or epic, break it into smaller components, and track the details **in the
repo** — committed alongside the code, so they travel across workspaces and machines, and so agents
and humans read the same record.

```
motte add "Design the schema"
motte assign schema atlas
motte status
motte serve
```

## Why it exists

Agents need somewhere durable to keep a plan. A scratch TODO list dies with the session, and a
hosted tracker is a lot of ceremony for a project with forty issues. motte puts the backlog in
`.motte/issues/` as Markdown files with YAML frontmatter — good diffs, readable on GitHub,
editable by hand, and one file per issue so parallel work rarely conflicts.

Three surfaces over one data model:

- **CLI** — `motte add`, `motte status`, `motte tree`, every read command with `--json`
- **Web UI** — `motte serve` for a board, a tree, issue detail, and progress reports
- **MCP server** — `motte mcp` so agents read and update work directly

## Install

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/CodeVachon/motte/main/install.sh | sh
```

Windows:

```powershell
irm https://raw.githubusercontent.com/CodeVachon/motte/main/install.ps1 | iex
```

The installer drops a single self-contained binary into `~/.motte/versions/v<X.Y.Z>/` and links it
onto your `PATH` at `~/.local/bin/motte`. There is no runtime prerequisite — no Node, no Bun. It
does not modify your current shell, so open a new terminal before the next step.

Then `motte upgrade` to update, `motte uninstall` to remove it.

## Getting started

```bash
motte init                              # writes .motte.config.json and .motte/issues/
motte add "Ship the thing"              # → #0001
motte add "Write the parser" -p 1       # a child of #0001
motte move 2 "in progress"
motte note 2 "Frontmatter beats JSON for diff quality."
motte status --epics
```

Commit `.motte.config.json` and `.motte/` — the backlog is the point.

### Issue references

Every command that takes an issue accepts a number **or** a fragment of the title, so you rarely
need to look an id up:

```bash
motte show 12
motte show round-trip          # same issue, matched on the title
motte assign schema atlas
```

An ambiguous fragment errors and lists the candidates rather than guessing.

## What an issue looks like

`.motte/issues/0042-design-the-schema.md`:

```markdown
---
id: 42
title: Design the schema
state: In Progress
parent: 7
assignee: atlas
labels: [core]
created: 2026-07-29T14:02:11Z
updated: 2026-07-29T15:31:04Z
---

## Description

Define the on-disk issue format so agents and humans can both read it.

## Plan

1. Draft the zod schema
2. Write round-trip fixtures

## Notes

### 2026-07-29T15:31:04Z — atlas (agent)

Chose frontmatter over pure JSON for diff quality.

### 2026-07-29T15:44:10Z — Christopher Vachon (user)

Agreed. Keep body sections fixed and ordered.
```

Description, Plan, and Notes are the sections motte knows about. **Any other section you add by hand
is preserved verbatim** when motte rewrites the file, so the format never fights you.

An "epic" is not a separate type — it is just an issue with children.

## Configuration

`.motte.config.json`, discovered by walking up from the working directory the way git finds `.git`:

```json
{
  "$schema": "https://codevachon.github.io/motte/schema/config.json",
  "name": "motte",
  "issuesDir": ".motte/issues",
  "defaultState": "Todo",
  "states": [
    { "name": "Todo", "category": "unstarted" },
    { "name": "In Progress", "category": "started" },
    { "name": "Blocked", "category": "started" },
    { "name": "Done", "category": "completed" },
    { "name": "Cancelled", "category": "cancelled" }
  ]
}
```

States are yours to name. The `category` on each is what makes progress reports work without
hardcoding names — rename `Done` to `Shipped` and the numbers still come out right. Cancelled work
leaves the denominator entirely, so abandoning an issue does not permanently cap a project below
100%.

## Agents

```bash
motte install                    # wires `motte mcp` into the agents on your machine
motte mcp --print-config         # or print the snippet and paste it yourself
```

Notes written through MCP are recorded as authored by the agent; notes written through the CLI are
recorded as authored by the git user. Both land in the same file — that is what makes the record
shared rather than parallel.

## A note on issue numbers

The next id is derived by scanning the issues directory, not from a counter file — a counter would
be a write-conflict on every single create. The trade is that two branches can each mint the same
number. `motte doctor` detects duplicates and `motte renumber` repairs them.

## Development

```bash
bun install
bun run test          # never `bun test` — different runner, different results
bun run typecheck
bun run doctor        # validates this repo's own backlog
bun run start -- status
```

This project is managed by itself: work on motte is tracked in motte's own `.motte/issues/`. See
[AGENTS.md](./AGENTS.md).

## License

MIT © Christopher Vachon
