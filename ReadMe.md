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

Then:

```bash
motte upgrade --check    # is there a newer release?
motte upgrade            # update in place
motte upgrade 0.1.0      # or pin a version
motte uninstall          # remove motte, leaving your project backlogs alone
```

An upgrade installs alongside the current version and repoints a symlink, so rolling back is a
symlink change rather than a reinstall. Old versions are pruned to the last two — these binaries carry
the whole Bun runtime, so they are not small. The version you are running is never pruned; it goes on
the next upgrade.

## Getting started

```bash
motte init                              # writes .motte.config.json and .motte/issues/
motte add "Ship the thing"              # → #0001
motte add "Write the parser" -p 1       # a child of #0001
motte move 2 "in progress"
motte note 2 "Frontmatter beats JSON for diff quality."
motte block 2 1                         # #0002 waits on #0001
motte ready                             # what can be picked up now
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

### Editing

Pass flags to change one field, or no flags to open the whole issue in `$EDITOR`:

```bash
motte edit 12 --state done --assignee atlas
motte edit 12                              # opens the raw Markdown
```

The editor gets a temp copy, so an unparseable result never overwrites a good issue — the draft is
kept and its path reported. `id` and `created` come from disk regardless of what you typed, since
they are identity rather than content, and `updated` is bumped for you. Rename the title and the
file is renamed to match.

Editor resolution follows git: `MOTTE_EDITOR`, then `VISUAL`, then `EDITOR`, then `vi` (`notepad` on
Windows). Commands with flags work — `EDITOR="code -w"`.

### Dependencies

Parent/child is a tree. Dependencies are a DAG that crosses it — a child of one epic can gate work
under another:

```bash
motte block 48 47        # #0048 waits on #0047
motte ready              # what can be picked up right now
motte ready --blocked    # what is waiting, and on what
motte list --ready
```

**Ready** means not settled and nothing standing in the way. It is computed, never stored — a
readiness field in a hand-edited file would go stale the moment someone closed a blocker without
touching what it blocked. Same reasoning applies to the inverse: only `blockedBy` is written to
disk, and "what does this block" is derived, because a two-sided relation in git-merged files will
drift and then two files disagree with no tiebreaker.

A cancelled blocker counts as settled. Abandoned work will never complete, so treating it as
blocking would strand everything downstream of it forever.

Cycles are rejected at write time and reported by `motte doctor`, since a dependency cycle is a
deadlock where nothing can ever be ready.

`blockedBy` is for prerequisites that _are_ issues. The `Blocked` state is for everything else —
waiting on a vendor, a decision, an access request. Deliberately two mechanisms: readiness is
computed, state stays authored.

### History

Every transition is recorded to `.motte/events/`, committed alongside the issues:

```bash
motte log                   # everything, oldest first
motte log 12                # one issue, plus how long it spent in each state
motte log --since 7d        # what moved this week
motte log --limit 20
motte doctor                # warns about work started more than 7 days ago
```

The log records **transitions only** — created, state, title, assignee, parent, blockers. Notes already
carry their own timestamp and author on the issue, and description or plan history is already in
`git log -p`, so recording either would be a second copy that could disagree with the first. `motte log`
merges the two at read time.

Shards are named `<YYYY-MM>.<actor>.ndjson`. The month bounds file size; the per-actor half means two
agents on two branches never write the same file, so append/append merge conflicts are structurally
impossible rather than merely rare.

Set `"events": { "enabled": false }` in the config to turn it off.

### Pruning old work

```bash
motte prune --before 90d --dry-run   # what would go, and why anything is kept
motte prune --before 2026-01 --yes
motte log --pruned                   # what can be brought back
motte restore 12
```

Never automatic — it deletes committed files, so it only happens when you ask, and `--before` has no
default. Each pruned issue leaves a **tombstone** recording the commit it can be recovered from, which is
what makes `motte restore` possible.

Three rules keep it safe, and each will refuse rather than guess:

- **A dirty backlog is refused.** The tombstone records `HEAD`, so uncommitted changes would make it
  point at content the commit does not have.
- **Anything a surviving issue still references is kept.** Removing it would leave a dangling `parent` or
  `blockedBy` — so pruning would trade disk space for a permanently broken backlog. A settled subtree
  goes whole or not at all, and `motte doctor` stays clean by construction.
- **Age is measured from when work actually stopped**, taken from the event log, not from `updated` —
  which moves on any edit, so a finished issue that later gets a note would never age out.

Commit a prune on its own: rewriting the event shards is the one operation that is not an append.

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
blockedBy: [11]
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
motte install               # wire the server into the agents on this machine
motte install --dry-run     # see what it would write first
motte mcp --print-config    # or paste the snippet yourself
```

`motte install` merges into existing config rather than replacing it, and records what it wrote — so
`motte uninstall --keep-cli` removes exactly that. A file motte created is deleted; a file motte merged
into keeps everything except motte's own entry. It refuses to touch a config file it cannot parse.

Claude Code's user-scope config lives in `~/.claude.json` alongside a lot of other state, so
`--scope user` delegates to `claude mcp add` rather than motte guessing at that file's shape.

Commit `.mcp.json` and every agent working in the repo picks it up.

The server tells agents to start with **`ready_issues`** rather than listing everything — unsettled work
with every blocker settled, which is the question an agent actually has at the start of a session. And
**`breakdown`** splits an issue into children in one call, expressing the ordering between them at the
same time, so decomposing an epic is one round trip rather than a dozen.

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
