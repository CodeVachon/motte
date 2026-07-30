---
id: 31
title: motte install — agent wiring
state: Done
parent: 5
labels: [mcp, agents]
created: 2026-07-29T11:53:00Z
updated: 2026-07-30T12:23:05Z
---

## Description

Write the MCP server config into the agents this project supports at v0.1: Claude Code (project
`.mcp.json`, or user `~/.claude.json`) and Codex CLI (`~/.codex/config.toml`).

Must merge into existing config rather than overwrite it, and be idempotent.

## Plan

1. Detect which agents are present
2. Merge into `.mcp.json` and `~/.codex/config.toml`, preserving unrelated entries
3. `--agent` and `--scope project|user` flags
4. Record what was written so `uninstall` can reverse exactly that

## Notes

### 2026-07-30T12:23:05Z — claude (agent)

Done. motte install wires the MCP server into Claude Code and Codex CLI, and motte uninstall --keep-cli
reverses exactly what was written.

The design turns on one distinction: whether motte created the config file or merged into one that
already existed. A file motte created is deleted on uninstall; a file motte merged into keeps everything
except motte's own entry, even if that leaves it with no servers. Guessing wrong destroys someone's
configuration, so the answer is recorded in ~/.motte/installed-agents.json at write time rather than
inferred later.

Verified against realistic files rather than empty ones: a .mcp.json already containing a sentry server,
and a config.toml with comments, a model setting and another mcp_servers table. All of it survived both
the install and the uninstall, and a merge-then-remove round trip restores the original.

Codex gets a targeted section edit rather than a TOML round trip. Parsing and re-emitting the whole file
would lose the user's comments and formatting, and adding a TOML library to avoid that is a lot of
dependency for one table.

Claude Code's user scope delegates to `claude mcp add --scope user`. That config lives in ~/.claude.json
alongside a lot of other state whose schema belongs to Claude Code, not to motte — so rather than guess
at it, motte asks the tool that owns it. The cost is that motte cannot reverse a delegated write, and
uninstall says so and points at `claude mcp remove motte` instead of pretending.

Refuses to touch a config file it cannot parse, for the same reason prune refuses on a dirty tree:
overwriting something unreadable destroys whatever else was in it. Verified against a deliberately
broken .mcp.json — it reports the parse error and leaves the file byte-identical.

Idempotent in both directions. Installing twice reports "already configured"; unwiring twice reports
there was nothing recorded.
