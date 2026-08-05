# Changelog

Everything below 1.0 shipped as a pre-release, because the documentation site and the schema URLs
every `.motte.config.json` points at did not exist yet. Both are live, and 1.0.0 is the first full
release.

## 1.0.0

The first full release. Everything the tool promised is now true: the schema URLs resolve, the site
exists, and the last commands the ReadMe described but did not have are built.

### Added

- **The published JSON Schemas.** `motte init` has written a `$schema` field since 0.1.0 and nothing
  was ever served there. `schema/config.json` and `schema/issue.json` are now live, generated from
  the same zod schemas that validate at runtime — a hand-written schema can describe a config the
  loader would reject, and an editor showing green on a file motte refuses is worse than no schema.
  A test compares the committed files against a fresh projection, so changing a schema without
  regenerating fails.
- **The landing page**, at [codevachon.github.io/motte](https://codevachon.github.io/motte/), with a
  Pages workflow that deploys it and the schemas together. The build refuses if a schema's `$id`
  disagrees with the URL it will be served at, and the deploy checks the live URL afterwards —
  a deployment can report success while serving nothing.
- **`motte watch`** — the backlog live in the terminal: progress, what is in flight and who has it,
  and a stream of transitions underneath. It shows the one thing the event log cannot record, an
  issue **becoming ready** because somebody else closed its blocker, which is the moment that
  matters when several agents are working. In a pipe it drops the dashboard and prints a line per
  change, so `motte watch | tee` works. `--interval` polls where watching is unreliable.
- **`motte projects`, `status --all`, `list --all`** — the questions no single repository can answer.
  What is assigned to me everywhere, what is in flight across all my work, where I left off. Any
  command run in a project registers it in `~/.motte/projects.json`; `MOTTE_NO_INDEX=1` turns that
  off. Summaries only, never issue bodies, and `--all` re-reads each project rather than trusting
  the cache.
- **`motte renumber`**, the other half of deriving ids from a directory scan. Two branches can each
  mint #7; `doctor` reported it and nothing could repair it, while the ReadMe promised this command.
  The issue that had the number first keeps it, the later one takes a fresh id above everything in
  use, and references it cannot disambiguate are reported rather than rewritten — a third issue
  saying `parent: 7` meant one of the two and nothing records which.
- **fish and PowerShell completion**, the two shells yargs has no template for, and completion is
  now wired up by the installer rather than left for you to find. `install.sh` generates all three
  unix scripts and switches fish on, since fish autoloads from a directory and needs no edit to a
  file you own; bash and zsh get the one line printed. `motte uninstall` removes the fish script,
  and only when it is the one motte generated.
- **`motte init` wires up agents and writes AGENTS.md.** A new project is one command rather than
  two. The AGENTS.md section covers what an MCP server cannot tell an agent: that `ready` is the
  question to start with, that a prerequisite belongs in `motte block` rather than in prose, and
  that notes are where the reasoning goes. It sits between markers, so nothing else in the file is
  ever touched.
- **`motte doctor` warns when a parent disagrees with its subtree**, in both directions: closed while
  work under it is open, or open when everything under it has settled. Both mislead the progress
  report and both were silent. It found four real cases in this repository the first time it ran.

### Fixed

- The web UI never said when it had lost the server. `EventSource` reconnects silently, and one tab
  had logged 198 failed attempts while showing a board that looked current. It now says so, keeps
  the data on screen, and re-reads on recovery — changes made during an outage produced events
  nobody received.
- `bun run dev:web` was entirely broken: the Host check compared ports, so Vite's proxy got a 403 on
  every request. The port comparison defended nothing, since a rebinding attempt is caught by the
  hostname.
- `motte list`, `motte ready` and the MCP read tools each had their own copy of the state, label and
  assignee filters. Three copies of "compare lowercased" is three chances for one of them to start
  treating a label differently, with nothing to notice.

### Notes

- The event log records transitions only. `motte watch` therefore compares snapshots and uses the
  log for attribution, rather than tailing it: notes are absent from the log by design, readiness is
  derived, and a file edited by hand produces no event at all.
- The project registry is a JSON file, not a database. It is a few dozen rows, and a file you can
  read and repair by hand is the same bargain the issue format makes.

## 0.4.0

The release that makes `motte serve` mean something. The web interface exists, is embedded in the
binary, and updates itself when an agent writes to the backlog.

### Added

- **The web interface.** `motte serve` opens a local, read-write UI on `127.0.0.1`: a **board** with
  columns drawn from the project's own configured states and drag to change state, a **tree** with drag
  to re-parent, an **issue page** that edits title, description, plan, state, assignee and parent in
  place and appends notes, and **reports** with progress and per-epic rollups. It is compiled into the
  binary, so an installed motte serves it with no flags and nothing beside it.
- **Live updates.** A JSON API over the same core the CLI uses, plus `GET /api/events` as server-sent
  events fed by a file watcher. Change an issue from the CLI or from an agent and any open tab follows
  along without a reload — which is the point, since the whole premise is that people and agents share
  one record.
- `motte` with no arguments now shows the status report inside a project, or the help outside one.

### Fixed

- `motte` with no arguments printed `✗ null`. `demandCommand` was given an empty message, and yargs
  passes null to the failure handler when the message is empty.
- `motte doctor` said "1 issues".

### Notes on the API, if you build against it

- Loopback only, and it checks the `Host` header. Without that check, a page on the internet could point
  its own hostname at 127.0.0.1 and drive your backlog through your browser — there is no
  authentication, because it is a local tool reading a local directory.
- Every write goes through core, so the web UI cannot drift from the CLI or the MCP server, and a change
  made in the browser lands in the event log under the same name the CLI would use.
- Response shapes are shared with the CLI's `--json`, with two derived additions: `openBlockers`, and an
  issue's `children`.

## 0.3.0

The release that made the tool trustworthy enough to rely on. Three new capabilities, a Windows
installer, and the first Windows binary anyone has ever run.

### Added

- **`motte install`** wires the MCP server into Claude Code or the Codex CLI, so an agent can read and
  update the backlog without hand-editing config. `--print-config` prints the snippet for anything else.
- **An event log.** Transitions are recorded to `.motte/events/` as committed NDJSON, sharded per month
  and per actor so two people appending on branches cannot conflict. `motte log` reads the timeline,
  `motte log --since 7d` narrows it, and time-in-state becomes answerable — which the issue files alone
  could never do, because `updated` moves on any edit.
- **`motte doctor` warns about stale work**, using that history: an issue sitting in a started state
  past `--stale-after` days. This is the check the event log was built for.
- **`motte prune`** removes settled issues past a cutoff and leaves a `pruned` tombstone recording the
  commit the file was last in. **`motte restore <id>`** reads it back out of that commit. `--dry-run`
  explains what would go and why; `--events-only` drops history while keeping the issues.
- **`install.ps1`** for Windows, invoked with `irm … | iex`. Same versioned layout as `install.sh`, but
  a junction for `current` (symlinks need administrator rights, junctions do not) and a user `PATH`
  entry instead of a link in `~/.local/bin`.
- **`motte doctor` checks round-trip integrity** — that reading a file and writing it back is a no-op.
  A file can parse cleanly and still not survive a rewrite, and nothing else notices.

### Fixed

- A label containing a comma broke the format's one hard guarantee. `motte add -l a,b` created a single
  label named `a,b`, which the writer emitted bare into an inline list and the parser then read back as
  two labels. `-l a,b` now means two labels, and a label that needs quoting gets quoted.
- `--json` omitted `blockedBy` entirely. Dependencies landed after the JSON shape was written and
  nothing updated it, so `motte block 2 1 --json` reported success without showing what it recorded.
  Both the CLI and MCP shapes now assert that every field of the issue model reaches the caller.
- `motte upgrade` reported a strictly newer release as a downgrade when its tag lacked a leading `v`,
  then offered to install it anyway. `install.sh` had always normalised the tag; the TypeScript had
  drifted from it.
- `motte status | head` died with an unhandled `EPIPE` and a stack trace instead of exiting quietly.
- `motte doctor` said "1 issues".
- Renaming an issue could leave the old file behind, producing a duplicate id.

### Changed

- The CLI test suite runs the commands in-process rather than spawning a process per assertion: about
  ten times faster, and the command modules are now actually covered rather than invisible to coverage.
- `motte doctor`'s checks are separate functions, and the MCP server's twelve tools are three modules
  instead of one 525-line function. No behaviour change — the existing tests passed untouched.

## 0.2.0

- The MCP server (`motte mcp`): twelve tools over stdio, including `ready_issues` and `breakdown`.
- `motte upgrade` and `motte uninstall`.
- Pre-1.0 releases are marked as prereleases, and the installer's version lookup handles that —
  GitHub's `/releases/latest` excludes prereleases, so it 404s and the fallback listing is the only
  path that finds anything.

## 0.1.0

First release: the issue format, the core data layer, the everyday CLI, `install.sh`, and a
cross-compiled binary for macOS, Linux and Windows.
