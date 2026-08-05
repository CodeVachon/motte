# motte

A lightweight project command center for small projects, where Linear, Jira, or even GitHub Issues
are complete overkill.

**[codevachon.github.io/motte](https://codevachon.github.io/motte/)**

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
motte init                              # config, issues dir, and the agent wiring
motte add "Ship the thing"              # → #0001
motte add "Write the parser" -p 1       # a child of #0001
motte move 2 "in progress"
motte note 2 "Frontmatter beats JSON for diff quality."
motte block 2 1                         # #0002 waits on #0001
motte ready                             # what can be picked up now
motte status --epics
```

`init` also wires up the agents it finds on the machine and writes motte's section of `AGENTS.md`, so a
new project is one command rather than two. Pass `--no-agents` to skip that.

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

### Tab completion

```bash
motte completion fish > ~/.config/fish/completions/motte.fish
echo 'source ~/.motte/completions/motte.zsh' >> ~/.zshrc      # or motte.bash for bash
motte completion powershell >> $PROFILE                        # Windows
```

`install.sh` generates all three scripts into `~/.motte/completions/` with the binary it just installed,
and switches fish on for you — fish autoloads from a known directory, so that needs no edit to a file you
own. bash and zsh do need one line, which the installer prints rather than adding.

Completion covers commands and flags, and — reading the project in the current directory — **issues by a
fragment of their title**, states, assignees and labels:

```
motte show pars<TAB>     → parser-rewrite     #0003 [Todo]
motte move 3 <TAB>       → Todo  In Progress  Done
motte list --label <TAB> → core  web  infra
```

That last part is the point of the whole reference model: every command takes a title fragment as readily
as an id, so completion turns "which number was that" into a non-question. Frontmatter is read without
parsing whole files to keep a keypress under 10ms on a backlog of a few hundred issues.

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

### Across projects

```bash
motte projects                       # every project motte has run in, most recent first
motte status --all                   # progress across all of them
motte list --all --assignee atlas    # what is assigned to somebody, everywhere
```

Any command run inside a project registers it in `~/.motte/projects.json`. That is what makes the questions
no single repository can answer answerable: what is assigned to me everywhere, what is in flight, where I
left off. Both `--all` flags work from anywhere, including outside a project.

It holds a summary only — counts, and what is in flight — never issue bodies, and the committed files stay
the only source of truth: `--all` re-reads each project rather than trusting the stored summary. A JSON file
rather than a database because it is a few dozen rows, and because a file you can read and repair by hand is
the same bargain the issue format makes.

Set `MOTTE_NO_INDEX=1` and motte keeps no record outside your repositories. A project that has moved or been
deleted is shown as `missing` rather than forgotten — it may be on a volume that is not mounted — and
`motte projects --prune` drops those once you say so.

### Watching it happen

```bash
motte watch                  # a live dashboard in the terminal
motte watch --interval 5     # poll instead, for filesystems where watching is unreliable
motte watch | tee run.log    # one line per change, for a pipe
```

The motivating case is several agents working at once: seeing that one has started an issue and another
has finished one, as it happens. It shows progress, what is in flight and who has it, and a stream of
transitions underneath — including the one the event log cannot record, an issue **becoming ready**
because somebody else closed its blocker.

`motte serve` covers the browser; this is for the window already open beside your editor. In a pipe it
drops the dashboard and prints a line per change instead, so redirecting it works.

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

`motte doctor` warns when a parent's state disagrees with its subtree, in either direction: closed while
work under it is still open, or still open when everything under it has settled. Both are quiet
otherwise, and both mislead the progress report — a closed epic carrying open work reports complete, and
an open one with nothing left in it never reports finished.

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

The `$schema` URL is live, so an editor autocompletes and validates the file as you type it:

- [`schema/config.json`](https://codevachon.github.io/motte/schema/config.json) — the project config
- [`schema/issue.json`](https://codevachon.github.io/motte/schema/issue.json) — an issue's frontmatter

Both are generated from the same zod schemas that validate at runtime, so an editor cannot tell you a
file is fine when motte would reject it.

## Agents

```bash
motte install               # wire the server into the agents on this machine
motte install --dry-run     # see what it would write first
motte mcp --print-config    # or paste the snippet yourself
```

`motte init` does this for you; `motte install` is for a project created before it did, or for wiring up
an agent installed later.

Alongside the MCP config it writes motte's section of `AGENTS.md`, between markers. Wiring the server tells
an agent that motte exists; it does not tell it how the project is meant to be worked — that `ready` is the
question to start with, that a prerequisite belongs in `motte block` rather than in prose, and that notes
are where the reasoning goes. Nothing outside the markers is touched, so the file stays the project's.
`--no-instructions` skips it.

`motte install` merges into existing config rather than replacing it, and records what it wrote — so
`motte uninstall --keep-cli` removes exactly that: motte's key out of a file it merged into, motte's block
out of `AGENTS.md`, and only a file motte itself created gets deleted. A file that predated motte keeps
everything except motte's own entry. It refuses to touch a config file it cannot parse.

Claude Code's user-scope config lives in `~/.claude.json` alongside a lot of other state, so
`--scope user` delegates to `claude mcp add` rather than motte guessing at that file's shape.

Commit `.mcp.json` and `AGENTS.md` and every agent working in the repo picks them up.

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
number. `motte doctor` detects duplicates and `motte renumber` repairs them:

```bash
motte renumber --dry-run   # what would move, and where
motte renumber
```

The issue that had the number first keeps it — earliest `created`, with the filename breaking a tie so
two people repairing the same merge get the same result. Whatever was filed later takes a fresh id above
everything in use, so a renumber never re-uses a number that is already in a branch name or a commit
message, and the file is renamed and gains a note saying where its number came from.

What it will not do is rewrite references. A third issue saying `parent: 7` meant one of the two files
and nothing on disk records which, so guessing would silently reshape your backlog. Those references are
listed instead; they still point at the issue that kept the id, which is a valid reference rather than a
dangling one.

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
